import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DriverActionDto {
  @ApiProperty()
  @IsUUID()
  driverId!: string;
}
