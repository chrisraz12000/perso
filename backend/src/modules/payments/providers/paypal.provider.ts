import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '@prisma/client';
import axios from 'axios';
import { ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import {
  MobileMoneyChargeParams,
  PaymentInitiationResult,
  PaymentProviderAdapter,
  PaymentStatusResult,
} from '../interfaces/payment-provider.interface';

interface PaypalTokenCache {
  token: string;
  expiresAt: number;
}

interface PaypalLink {
  rel: string;
  href: string;
}

@Injectable()
export class PaypalProvider implements PaymentProviderAdapter {
  private tokenCache: PaypalTokenCache | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly exchangeRate: ExchangeRateService,
  ) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('PAYPAL_BASE_URL');
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    const credentials = Buffer.from(
      `${this.config.getOrThrow('PAYPAL_CLIENT_ID')}:${this.config.getOrThrow('PAYPAL_CLIENT_SECRET')}`,
    ).toString('base64');

    const { data } = await axios.post(
      `${this.baseUrl}/v1/oauth2/token`,
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
    const amountUsd = await this.exchangeRate.convertMgaToUsd(amount);
    const appName = this.config.get<string>('appName') ?? 'TaxiMada';

    const { data } = await axios.post(
      `${this.baseUrl}/v2/checkout/orders`,
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: `RIDE-${rideId}`,
            description: `Course taxi - ${amount} Ar`,
            amount: {
              currency_code: this.config.get<string>('PAYPAL_CURRENCY') ?? 'USD',
              value: amountUsd.toFixed(2),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: appName,
              locale: 'fr-MG',
              landing_page: 'LOGIN',
              user_action: 'PAY_NOW',
              return_url: this.config.getOrThrow('PAYPAL_RETURN_URL'),
              cancel_url: this.config.getOrThrow('PAYPAL_CANCEL_URL'),
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `RIDE-${rideId}-${Date.now()}`,
        },
      },
    );

    const approveUrl = (data.links as PaypalLink[] | undefined)?.find(
      (link) => link.rel === 'payer-action',
    )?.href;

    return { providerRef: data.id, status: PaymentStatus.PENDING, redirectUrl: approveUrl };
  }

  async capture(orderId: string): Promise<PaymentStatusResult> {
    const token = await this.getToken();

    const { data } = await axios.post(
      `${this.baseUrl}/v2/checkout/orders/${orderId}/capture`,
      {},
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );

    const capture = data.purchase_units[0].payments.captures[0];
    return {
      status: capture.status === 'COMPLETED' ? PaymentStatus.SUCCESS : PaymentStatus.FAILED,
      externalRef: capture.id,
    };
  }

  async checkStatus(orderId: string): Promise<PaymentStatusResult> {
    const token = await this.getToken();

    const { data } = await axios.get(`${this.baseUrl}/v2/checkout/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return { status: data.status === 'COMPLETED' ? PaymentStatus.SUCCESS : PaymentStatus.PENDING };
  }

  async verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<boolean> {
    const token = await this.getToken();

    const { data } = await axios.post(
      `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
      {
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: this.config.getOrThrow('PAYPAL_WEBHOOK_ID'),
        webhook_event: body,
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );

    return data.verification_status === 'SUCCESS';
  }
}
