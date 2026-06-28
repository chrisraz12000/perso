import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '@prisma/client';
import axios from 'axios';
import { toInternationalFormat } from '../../../common/utils/phone.util';
import {
  MobileMoneyChargeParams,
  PaymentInitiationResult,
  PaymentProviderAdapter,
  PaymentStatusResult,
} from '../interfaces/payment-provider.interface';

interface AirtelTokenCache {
  token: string;
  expiresAt: number;
}

@Injectable()
export class AirtelProvider implements PaymentProviderAdapter {
  private tokenCache: AirtelTokenCache | null = null;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('AIRTEL_BASE_URL');
  }

  private get country(): string {
    return this.config.get<string>('AIRTEL_COUNTRY') ?? 'MG';
  }

  private get currency(): string {
    return this.config.get<string>('AIRTEL_CURRENCY') ?? 'MGA';
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    const { data } = await axios.post(
      `${this.baseUrl}/auth/oauth2/token`,
      {
        client_id: this.config.getOrThrow('AIRTEL_CLIENT_ID'),
        client_secret: this.config.getOrThrow('AIRTEL_CLIENT_SECRET'),
        grant_type: 'client_credentials',
      },
      { headers: { 'Content-Type': 'application/json' } },
    );

    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return this.tokenCache.token;
  }

  async initiate({ rideId, amount, customerPhone }: MobileMoneyChargeParams): Promise<PaymentInitiationResult> {
    const token = await this.getToken();
    const transactionId = `AIRTEL-${rideId}-${Date.now()}`;
    const msisdn = toInternationalFormat(customerPhone);

    await axios.post(
      `${this.baseUrl}/merchant/v1/payments/`,
      {
        reference: `Course ${rideId}`,
        subscriber: { country: this.country, currency: this.currency, msisdn },
        transaction: { amount, country: this.country, currency: this.currency, id: transactionId },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Country': this.country,
          'X-Currency': this.currency,
        },
      },
    );

    return { providerRef: transactionId, status: PaymentStatus.PENDING };
  }

  async checkStatus(transactionId: string): Promise<PaymentStatusResult> {
    const token = await this.getToken();

    const { data } = await axios.get(`${this.baseUrl}/standard/v1/payments/${transactionId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Country': this.country,
        'X-Currency': this.currency,
      },
    });

    const transaction = data.data?.transaction;
    return { status: this.mapStatus(transaction?.status), externalRef: transaction?.airtel_money_id };
  }

  private mapStatus(status?: string): PaymentStatus {
    switch (status) {
      case 'TS':
        return PaymentStatus.SUCCESS;
      case 'TF':
        return PaymentStatus.FAILED;
      default:
        return PaymentStatus.PENDING;
    }
  }
}
