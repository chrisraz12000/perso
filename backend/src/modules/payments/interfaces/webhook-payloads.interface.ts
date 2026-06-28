export interface MvolaCallbackPayload {
  serverCorrelationId: string;
  status: string;
  transactionReference?: string;
}

export interface AirtelCallbackPayload {
  transaction: {
    id: string;
    status: string;
    airtel_money_id?: string;
  };
}

export interface OrangeCallbackPayload {
  pay_token: string;
  status: string;
  txnid?: string;
}

export interface PaypalWebhookEvent {
  event_type: string;
  resource: {
    id: string;
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
  };
}
