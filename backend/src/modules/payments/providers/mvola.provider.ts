import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '@prisma/client';
import axios from 'axios';
import {
  MobileMoneyChargeParams,
  PaymentInitiationResult,
  PaymentProviderAdapter,
  PaymentStatusResult,
} from '../interfaces/payment-provider.interface';

interface MvolaTokenCache {
  token: string;
  expiresAt: number;
}

@Injectable()
export class MvolaProvider implements PaymentProviderAdapter {
  private tokenCache: MvolaTokenCache | null = null;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('MVOLA_BASE_URL');
  }

  private get appName(): string {
    return this.config.get<string>('appName') ?? 'TaxiMada';
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    const credentials = Buffer.from(
      `${this.config.getOrThrow('MVOLA_CONSUMER_KEY')}:${this.config.getOrThrow('MVOLA_CONSUMER_SECRET')}`,
    ).toString('base64');

    const { data } = await axios.post(
      `${this.baseUrl}/token`,
      'grant_type=client_credentials&scope=EXT_INT_MVOLA_SCOPE',
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cache-Control': 'no-cache',
        },
      },
    );

    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return this.tokenCache.token;
  }

  async initiate({ rideId, amount, customerPhone }: MobileMoneyChargeParams): Promise<PaymentInitiationResult> {
    const token = await this.getToken();
    const merchantNumber = this.config.getOrThrow<string>('MVOLA_MERCHANT_NUMBER');
    const correlationId = `RIDE-${rideId}-${Date.now()}`;

    const { data } = await axios.post(
      `${this.baseUrl}/mvola/mm/transactions/type/merchantpay`,
      {
        amount: amount.toString(),
        currency: 'Ar',
        descriptionText: `Course ${this.appName}-${rideId}`,
        requestingOrganisationTransactionReference: correlationId,
        requestDate: new Date().toISOString(),
        originalTransactionReference: correlationId,
        debitParty: [{ key: 'msisdn', value: customerPhone }],
        creditParty: [{ key: 'msisdn', value: merchantNumber }],
        metadata: [
          { key: 'partnerName', value: this.appName },
          { key: 'fc', value: 'USD' },
          { key: 'amountFc', value: '1' },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-CorrelationID': correlationId,
          'X-Version': '1.0',
          UserLanguage: 'MG',
          UserAccountIdentifier: `msisdn;${merchantNumber}`,
          partnerName: this.appName,
          'Cache-Control': 'no-cache',
        },
      },
    );

    return { providerRef: data.serverCorrelationId, status: PaymentStatus.PENDING };
  }

  async checkStatus(serverCorrelationId: string): Promise<PaymentStatusResult> {
    const token = await this.getToken();
    const merchantNumber = this.config.getOrThrow<string>('MVOLA_MERCHANT_NUMBER');

    const { data } = await axios.get(
      `${this.baseUrl}/mvola/mm/transactions/type/merchantpay/${serverCorrelationId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-CorrelationID': serverCorrelationId,
          'X-Version': '1.0',
          UserLanguage: 'MG',
          UserAccountIdentifier: `msisdn;${merchantNumber}`,
          partnerName: this.appName,
          'Cache-Control': 'no-cache',
        },
      },
    );

    return {
      status: this.mapStatus(data.status),
      externalRef: data.transactionReference,
    };
  }

  private mapStatus(status: string): PaymentStatus {
    switch (status) {
      case 'completed':
        return PaymentStatus.SUCCESS;
      case 'failed':
        return PaymentStatus.FAILED;
      default:
        return PaymentStatus.PENDING;
    }
  }
}
