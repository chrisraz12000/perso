import { Module } from '@nestjs/common';
import { GoogleMapsModule } from '../../common/maps/google-maps.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [PricingModule, GoogleMapsModule, PaymentsModule],
  controllers: [RidesController],
  providers: [RidesService],
  exports: [RidesService],
})
export class RidesModule {}
