import { PaymentStatus } from '@prisma/client';

export interface MobileMoneyChargeParams {
  rideId: string;
  amount: number;
  customerPhone: string;
}

export interface PaymentInitiationResult {
  providerRef: string | null;
  status: PaymentStatus;
  redirectUrl?: string;
}

export interface PaymentStatusResult {
  status: PaymentStatus;
  externalRef?: string;
}

export interface PaymentProviderAdapter {
  initiate(params: MobileMoneyChargeParams): Promise<PaymentInitiationResult>;
  checkStatus(providerRef: string): Promise<PaymentStatusResult>;
}
