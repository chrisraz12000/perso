import { ApiProperty } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';
import { EstimateRideDto } from './estimate-ride.dto';

export class RequestRideDto extends EstimateRideDto {
  @ApiProperty()
  @IsUUID()
  passengerId!: string;

  @ApiProperty({ enum: PaymentProvider })
  @IsEnum(PaymentProvider)
  paymentMethod!: PaymentProvider;
}
