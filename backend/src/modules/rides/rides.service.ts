import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Ride, RideStatus } from '@prisma/client';
import { GoogleMapsService } from '../../common/maps/google-maps.service';
import { GeoPoint } from '../../common/utils/geo.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../payments/payment.service';
import { FareBreakdown, PricingService } from '../pricing/pricing.service';
import { EstimateRideDto } from './dto/estimate-ride.dto';
import { RequestRideDto } from './dto/request-ride.dto';

export interface RideEstimate extends FareBreakdown {
  distanceKm: number;
  durationMin: number;
}

interface NearbyDriver {
  driverId: string;
  distanceKm: number;
}

interface DispatchState {
  candidateIds: string[];
  currentIndex: number;
  timer: NodeJS.Timeout | null;
}

const DISPATCH_RADIUS_KM = 5;
const OFFER_TIMEOUT_MS = 15_000;
const ACTIVE_RIDE_STATUSES: RideStatus[] = [
  RideStatus.ACCEPTED,
  RideStatus.DRIVER_ARRIVED,
  RideStatus.IN_PROGRESS,
];

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);
  private readonly dispatches = new Map<string, DispatchState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly googleMaps: GoogleMapsService,
    private readonly paymentService: PaymentService,
    private readonly events: EventEmitter2,
  ) {}

  async estimateRide(dto: EstimateRideDto): Promise<RideEstimate> {
    const { distanceKm, durationMin } = await this.googleMaps.getRoute(
      { lat: dto.pickupLat, lng: dto.pickupLng },
      { lat: dto.dropoffLat, lng: dto.dropoffLng },
    );
    const fare = this.pricing.calculateFare(distanceKm, durationMin);
    return { distanceKm, durationMin, ...fare };
  }

  async requestRide(dto: RequestRideDto): Promise<Ride> {
    const estimate = await this.estimateRide(dto);

    const ride = await this.prisma.ride.create({
      data: {
        passengerId: dto.passengerId,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        pickupAddress: dto.pickupAddress,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        dropoffAddress: dto.dropoffAddress,
        distanceKm: estimate.distanceKm,
        durationMin: estimate.durationMin,
        priceAriary: estimate.priceAriary,
        surgeMultiplier: estimate.surgeMultiplier,
        paymentMethod: dto.paymentMethod,
        status: RideStatus.SEARCHING,
      },
    });

    this.events.emit('ride.requested', { rideId: ride.id });
    await this.startDispatch(ride.id, { lat: ride.pickupLat, lng: ride.pickupLng });

    return ride;
  }

  async acceptRide(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.findByIdOrThrow(rideId);
    if (ride.status !== RideStatus.SEARCHING) {
      throw new ConflictException('This ride is no longer searching for a driver');
    }

    const state = this.dispatches.get(rideId);
    const offeredDriverId = state?.candidateIds[state.currentIndex];
    if (!state || offeredDriverId !== driverId) {
      throw new ConflictException('This ride is not currently offered to this driver');
    }

    this.clearDispatchTimer(state);
    this.dispatches.delete(rideId);

    const updated = await this.prisma.ride.update({
      where: { id: rideId },
      data: { driverId, status: RideStatus.ACCEPTED },
    });

    this.events.emit('ride.accepted', { rideId, driverId });
    return updated;
  }

  async rejectRide(rideId: string, driverId: string): Promise<void> {
    const ride = await this.findByIdOrThrow(rideId);
    if (ride.status !== RideStatus.SEARCHING) {
      return;
    }

    const state = this.dispatches.get(rideId);
    const offeredDriverId = state?.candidateIds[state.currentIndex];
    if (!state || offeredDriverId !== driverId) {
      throw new ConflictException('This ride is not currently offered to this driver');
    }

    this.clearDispatchTimer(state);
    this.events.emit('ride.rejected_by_driver', { rideId, driverId });
    state.currentIndex += 1;
    await this.offerToCurrentCandidate(rideId);
  }

  async markDriverArrived(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.assertDriverOwnsRide(rideId, driverId, RideStatus.ACCEPTED);
    const updated = await this.prisma.ride.update({
      where: { id: ride.id },
      data: { status: RideStatus.DRIVER_ARRIVED },
    });
    this.events.emit('ride.driver_arrived', { rideId });
    return updated;
  }

  async startRide(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.assertDriverOwnsRide(rideId, driverId, RideStatus.DRIVER_ARRIVED);
    const updated = await this.prisma.ride.update({
      where: { id: ride.id },
      data: { status: RideStatus.IN_PROGRESS, startedAt: new Date() },
    });
    this.events.emit('ride.started', { rideId });
    return updated;
  }

  async completeRide(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.assertDriverOwnsRide(rideId, driverId, RideStatus.IN_PROGRESS);
    const updated = await this.prisma.ride.update({
      where: { id: ride.id },
      data: { status: RideStatus.COMPLETED, completedAt: new Date() },
    });

    try {
      await this.paymentService.initiatePayment(rideId);
    } catch (error) {
      this.logger.warn(`Failed to auto-initiate payment for ride ${rideId}: ${(error as Error).message}`);
    }

    this.events.emit('ride.completed', { rideId });
    return updated;
  }

  async cancelRide(rideId: string, userId: string): Promise<Ride> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: { driver: true },
    });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.status === RideStatus.COMPLETED || ride.status === RideStatus.CANCELLED) {
      throw new ConflictException('This ride can no longer be cancelled');
    }
    if (ride.passengerId !== userId && ride.driver?.userId !== userId) {
      throw new ForbiddenException('You are not part of this ride');
    }

    const state = this.dispatches.get(rideId);
    if (state) {
      this.clearDispatchTimer(state);
      this.dispatches.delete(rideId);
    }

    const updated = await this.prisma.ride.update({
      where: { id: rideId },
      data: { status: RideStatus.CANCELLED },
    });
    this.events.emit('ride.cancelled', { rideId, cancelledBy: userId });
    return updated;
  }

  async findById(rideId: string): Promise<Ride> {
    return this.findByIdOrThrow(rideId);
  }

  async findNearbyAvailableDrivers(
    pickup: GeoPoint,
    radiusKm: number = DISPATCH_RADIUS_KM,
  ): Promise<NearbyDriver[]> {
    const radiusMeters = radiusKm * 1000;
    return this.prisma.$queryRaw<NearbyDriver[]>`
      SELECT d.id AS "driverId",
        ST_DistanceSphere(
          ST_MakePoint(dl.lng, dl.lat),
          ST_MakePoint(${pickup.lng}, ${pickup.lat})
        ) / 1000 AS "distanceKm"
      FROM "Driver" d
      JOIN "DriverLocation" dl ON dl."driverId" = d.id
      WHERE d."isOnline" = true
        AND d.status = 'APPROVED'
        AND NOT EXISTS (
          SELECT 1 FROM "Ride" r
          WHERE r."driverId" = d.id
            AND r.status IN ('ACCEPTED', 'DRIVER_ARRIVED', 'IN_PROGRESS')
        )
        AND ST_DistanceSphere(
          ST_MakePoint(dl.lng, dl.lat),
          ST_MakePoint(${pickup.lng}, ${pickup.lat})
        ) <= ${radiusMeters}
      ORDER BY "distanceKm" ASC
    `;
  }

  private async startDispatch(rideId: string, pickup: GeoPoint): Promise<void> {
    const candidates = await this.findNearbyAvailableDrivers(pickup);
    if (candidates.length === 0) {
      this.events.emit('ride.no_drivers_found', { rideId });
      return;
    }

    this.dispatches.set(rideId, {
      candidateIds: candidates.map((c) => c.driverId),
      currentIndex: 0,
      timer: null,
    });
    await this.offerToCurrentCandidate(rideId);
  }

  private async offerToCurrentCandidate(rideId: string): Promise<void> {
    const state = this.dispatches.get(rideId);
    if (!state) {
      return;
    }

    if (state.currentIndex >= state.candidateIds.length) {
      this.dispatches.delete(rideId);
      this.events.emit('ride.no_drivers_found', { rideId });
      return;
    }

    const driverId = state.candidateIds[state.currentIndex];
    this.events.emit('ride.driver_offered', { rideId, driverId });

    state.timer = setTimeout(() => {
      void this.advanceDispatch(rideId);
    }, OFFER_TIMEOUT_MS);
  }

  private async advanceDispatch(rideId: string): Promise<void> {
    const state = this.dispatches.get(rideId);
    if (!state) {
      return;
    }
    state.currentIndex += 1;
    await this.offerToCurrentCandidate(rideId);
  }

  private clearDispatchTimer(state: DispatchState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  private async findByIdOrThrow(rideId: string): Promise<Ride> {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    return ride;
  }

  private async assertDriverOwnsRide(
    rideId: string,
    driverId: string,
    expectedStatus: RideStatus,
  ): Promise<Ride> {
    const ride = await this.findByIdOrThrow(rideId);
    if (ride.driverId !== driverId) {
      throw new ForbiddenException('This ride is not assigned to this driver');
    }
    if (ride.status !== expectedStatus) {
      throw new ConflictException(`Ride must be in ${expectedStatus} status for this action`);
    }
    return ride;
  }
}
