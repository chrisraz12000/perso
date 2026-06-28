import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CancelRideDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;
}
