import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { DriverActionDto } from './dto/driver-action.dto';
import { EstimateRideDto } from './dto/estimate-ride.dto';
import { RequestRideDto } from './dto/request-ride.dto';
import { RidesService } from './rides.service';

@ApiTags('rides')
@Controller('rides')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @Post('estimate')
  @ApiOperation({ summary: 'Estimate distance, duration, and fare for a trip' })
  estimate(@Body() dto: EstimateRideDto) {
    return this.ridesService.estimateRide(dto);
  }

  @Post()
  @ApiOperation({ summary: 'Request a new ride and start driver dispatch' })
  request(@Body() dto: RequestRideDto) {
    return this.ridesService.requestRide(dto);
  }

  @Get(':rideId')
  @ApiOperation({ summary: 'Get the current state of a ride' })
  findOne(@Param('rideId', ParseUUIDPipe) rideId: string) {
    return this.ridesService.findById(rideId);
  }

  @Post(':rideId/accept')
  @ApiOperation({ summary: 'Driver accepts the currently offered ride' })
  accept(@Param('rideId', ParseUUIDPipe) rideId: string, @Body() dto: DriverActionDto) {
    return this.ridesService.acceptRide(rideId, dto.driverId);
  }

  @Post(':rideId/reject')
  @ApiOperation({ summary: 'Driver rejects the currently offered ride' })
  reject(@Param('rideId', ParseUUIDPipe) rideId: string, @Body() dto: DriverActionDto) {
    return this.ridesService.rejectRide(rideId, dto.driverId);
  }

  @Post(':rideId/arrived')
  @ApiOperation({ summary: 'Driver marks themselves as arrived at pickup' })
  arrived(@Param('rideId', ParseUUIDPipe) rideId: string, @Body() dto: DriverActionDto) {
    return this.ridesService.markDriverArrived(rideId, dto.driverId);
  }

  @Post(':rideId/start')
  @ApiOperation({ summary: 'Driver starts the trip' })
  start(@Param('rideId', ParseUUIDPipe) rideId: string, @Body() dto: DriverActionDto) {
    return this.ridesService.startRide(rideId, dto.driverId);
  }

  @Post(':rideId/complete')
  @ApiOperation({ summary: 'Driver completes the trip and triggers payment' })
  complete(@Param('rideId', ParseUUIDPipe) rideId: string, @Body() dto: DriverActionDto) {
    return this.ridesService.completeRide(rideId, dto.driverId);
  }

  @Post(':rideId/cancel')
  @ApiOperation({ summary: 'Passenger or driver cancels the ride' })
  cancel(@Param('rideId', ParseUUIDPipe) rideId: string, @Body() dto: CancelRideDto) {
    return this.ridesService.cancelRide(rideId, dto.userId);
  }
}
