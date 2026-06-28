import { Module } from '@nestjs/common';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { AirtelProvider } from './providers/airtel.provider';
import { MvolaProvider } from './providers/mvola.provider';
import { OrangeProvider } from './providers/orange.provider';
import { PaypalProvider } from './providers/paypal.provider';

@Module({
  imports: [ExchangeRateModule],
  controllers: [PaymentController],
  providers: [PaymentService, MvolaProvider, AirtelProvider, OrangeProvider, PaypalProvider],
  exports: [PaymentService],
})
export class PaymentsModule {}
