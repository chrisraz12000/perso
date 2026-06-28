import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Payment, PaymentProvider, PaymentStatus, Prisma } from '@prisma/client';
import { ExchangeRateService } from '../../common/exchange-rate/exchange-rate.service';
import { detectOperator, MobileMoneyOperator } from '../../common/utils/phone.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MobileMoneyChargeParams,
  PaymentInitiationResult,
  PaymentStatusResult,
} from './interfaces/payment-provider.interface';
import { AirtelProvider } from './providers/airtel.provider';
import { MvolaProvider } from './providers/mvola.provider';
import { OrangeProvider } from './providers/orange.provider';
import { PaypalProvider } from './providers/paypal.provider';

type RideWithPassenger = Prisma.RideGetPayload<{ include: { passenger: true; payment: true } }>;

const PROVIDER_TO_OPERATOR: Partial<Record<PaymentProvider, MobileMoneyOperator>> = {
  [PaymentProvider.MVOLA]: 'mvola',
  [PaymentProvider.AIRTEL]: 'airtel',
  [PaymentProvider.ORANGE]: 'orange',
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mvola: MvolaProvider,
    private readonly airtel: AirtelProvider,
    private readonly orange: OrangeProvider,
    private readonly paypal: PaypalProvider,
    private readonly exchangeRate: ExchangeRateService,
    private readonly events: EventEmitter2,
  ) {}

  getPaypalProvider(): PaypalProvider {
    return this.paypal;
  }

  async initiatePayment(rideId: string): Promise<PaymentInitiationResult & { provider: PaymentProvider }> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: { passenger: true, payment: true },
    });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.payment?.status === PaymentStatus.SUCCESS) {
      throw new ConflictException('This ride has already been paid');
    }

    const provider = ride.paymentMethod;
    const result = await this.chargeWithProvider(provider, ride);

    const amount =
      provider === PaymentProvider.PAYPAL
        ? await this.exchangeRate.convertMgaToUsd(ride.priceAriary)
        : ride.priceAriary;

    await this.prisma.payment.upsert({
      where: { rideId },
      create: {
        rideId,
        amount,
        currency: provider === PaymentProvider.PAYPAL ? 'USD' : 'MGA',
        provider,
        providerRef: result.providerRef,
        status: result.status,
      },
      update: {
        providerRef: result.providerRef,
        status: result.status,
      },
    });

    if (provider === PaymentProvider.PAYPAL) {
      await this.prisma.ride.update({ where: { id: rideId }, data: { priceUsd: amount } });
    }

    return { provider, ...result };
  }

  async refreshStatus(rideId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { rideId } });
    if (!payment) {
      throw new NotFoundException('Payment not found for this ride');
    }
    if (payment.status !== PaymentStatus.PENDING || !payment.providerRef) {
      return payment;
    }

    const result = await this.checkProviderStatus(payment.provider, payment.providerRef);
    if (result.status === payment.status) {
      return payment;
    }

    const updated = await this.prisma.payment.update({
      where: { rideId },
      data: { status: result.status, externalRef: result.externalRef },
    });
    await this.prisma.ride.update({ where: { id: rideId }, data: { paymentStatus: result.status } });
    this.events.emit('payment.confirmed', { rideId, status: result.status });

    return updated;
  }

  async confirmPayment(input: {
    providerRef: string;
    status: PaymentStatus;
    externalRef?: string;
  }): Promise<void> {
    let payment: Payment;
    try {
      payment = await this.prisma.payment.update({
        where: { providerRef: input.providerRef },
        data: { status: input.status, externalRef: input.externalRef },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        this.logger.warn(`Received webhook for unknown providerRef: ${input.providerRef}`);
        return;
      }
      throw error;
    }

    await this.prisma.ride.update({
      where: { id: payment.rideId },
      data: { paymentStatus: input.status },
    });

    this.events.emit('payment.confirmed', { rideId: payment.rideId, status: input.status });
  }

  private async chargeWithProvider(
    provider: PaymentProvider,
    ride: RideWithPassenger,
  ): Promise<PaymentInitiationResult> {
    const params: MobileMoneyChargeParams = {
      rideId: ride.id,
      amount: ride.priceAriary,
      customerPhone: ride.passenger.phone,
    };

    const requiredOperator = PROVIDER_TO_OPERATOR[provider];
    if (requiredOperator) {
      this.assertOperatorMatches(requiredOperator, ride.passenger.phone);
    }

    switch (provider) {
      case PaymentProvider.MVOLA:
        return this.mvola.initiate(params);
      case PaymentProvider.AIRTEL:
        return this.airtel.initiate(params);
      case PaymentProvider.ORANGE:
        return this.orange.initiate(params);
      case PaymentProvider.PAYPAL:
        return this.paypal.initiate(params);
      case PaymentProvider.CASH:
        return { providerRef: null, status: PaymentStatus.PENDING };
      default:
        throw new BadRequestException(`Unsupported payment provider: ${provider}`);
    }
  }

  private async checkProviderStatus(
    provider: PaymentProvider,
    providerRef: string,
  ): Promise<PaymentStatusResult> {
    switch (provider) {
      case PaymentProvider.MVOLA:
        return this.mvola.checkStatus(providerRef);
      case PaymentProvider.AIRTEL:
        return this.airtel.checkStatus(providerRef);
      case PaymentProvider.ORANGE:
        return this.orange.checkStatus(providerRef);
      case PaymentProvider.PAYPAL:
        return this.paypal.checkStatus(providerRef);
      default:
        return { status: PaymentStatus.PENDING };
    }
  }

  private assertOperatorMatches(expected: MobileMoneyOperator, phone: string): void {
    const detected = detectOperator(phone);
    if (detected !== expected) {
      throw new BadRequestException(`Phone number ${phone} does not match the ${expected} network`);
    }
  }
}
