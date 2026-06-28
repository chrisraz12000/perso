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

interface OrangeTokenCache {
  token: string;
  expiresAt: number;
}

@Injectable()
export class OrangeProvider implements PaymentProviderAdapter {
  private tokenCache: OrangeTokenCache | null = null;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('ORANGE_BASE_URL');
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    const credentials = Buffer.from(
      `${this.config.getOrThrow('ORANGE_CLIENT_ID')}:${this.config.getOrThrow('ORANGE_CLIENT_SECRET')}`,
    ).toString('base64');

    const { data } = await axios.post(
      'https://api.orange.com/oauth/v3/token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return this.tokenCache.token;
  }

  async initiate({ rideId, amount }: MobileMoneyChargeParams): Promise<PaymentInitiationResult> {
    const token = await this.getToken();

    const { data } = await axios.post(
      `${this.baseUrl}/webpayment`,
      {
        merchant_key: this.config.getOrThrow('ORANGE_MERCHANT_KEY'),
        currency: 'MGA',
        order_id: `RIDE-${rideId}`,
        amount,
        return_url: this.config.getOrThrow('ORANGE_RETURN_URL'),
        cancel_url: this.config.getOrThrow('ORANGE_CANCEL_URL'),
        notif_url: this.config.getOrThrow('ORANGE_CALLBACK_URL'),
        lang: 'fr',
        reference: `Course taxi ${rideId}`,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return {
      providerRef: data.pay_token,
      status: PaymentStatus.PENDING,
      redirectUrl: data.payment_url,
    };
  }

  async checkStatus(payToken: string): Promise<PaymentStatusResult> {
    const token = await this.getToken();

    const { data } = await axios.post(
      `${this.baseUrl}/transactionstatus`,
      {
        merchant_key: this.config.getOrThrow('ORANGE_MERCHANT_KEY'),
        pay_token: payToken,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return { status: this.mapStatus(data.status), externalRef: data.txnid };
  }

  private mapStatus(status: string): PaymentStatus {
    switch (status) {
      case 'SUCCESS':
        return PaymentStatus.SUCCESS;
      case 'FAILED':
        return PaymentStatus.FAILED;
      case 'EXPIRED':
        return PaymentStatus.EXPIRED;
      default:
        return PaymentStatus.PENDING;
    }
  }
}
