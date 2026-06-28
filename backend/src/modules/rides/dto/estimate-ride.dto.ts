import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsString, MinLength } from 'class-validator';

export class EstimateRideDto {
  @ApiProperty()
  @IsLatitude()
  pickupLat!: number;

  @ApiProperty()
  @IsLongitude()
  pickupLng!: number;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  pickupAddress!: string;

  @ApiProperty()
  @IsLatitude()
  dropoffLat!: number;

  @ApiProperty()
  @IsLongitude()
  dropoffLng!: number;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  dropoffAddress!: string;
}
