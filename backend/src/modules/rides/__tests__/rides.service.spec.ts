import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException } from '@nestjs/common';
import { RideStatus } from '@prisma/client';
import { RidesService } from '../rides.service';

function buildRide(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    driverId: null,
    status: RideStatus.SEARCHING,
    pickupLat: -18.8792,
    pickupLng: 47.5079,
    pickupAddress: 'Analakely',
    dropoffLat: -18.91,
    dropoffLng: 47.525,
    dropoffAddress: 'Ankorondrano',
    distanceKm: 4,
    durationMin: 12,
    priceAriary: 8000,
    priceUsd: null,
    paymentMethod: 'CASH',
    paymentStatus: 'PENDING',
    surgeMultiplier: 1,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('RidesService dispatch', () => {
  let prisma: { ride: Record<string, jest.Mock> };
  let pricing: { calculateFare: jest.Mock };
  let googleMaps: { getRoute: jest.Mock };
  let paymentService: { initiatePayment: jest.Mock };
  let events: EventEmitter2;
  let service: RidesService;
  let ride: ReturnType<typeof buildRide>;

  beforeEach(() => {
    jest.useFakeTimers();
    ride = buildRide();

    prisma = {
      ride: {
        create: jest.fn().mockResolvedValue(ride),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(ride)),
        update: jest.fn().mockImplementation(({ data }) => {
          ride = { ...ride, ...data };
          return Promise.resolve(ride);
        }),
      },
    };
    pricing = { calculateFare: jest.fn() };
    googleMaps = { getRoute: jest.fn() };
    paymentService = { initiatePayment: jest.fn().mockResolvedValue(undefined) };
    events = new EventEmitter2();

    service = new RidesService(
      prisma as any,
      pricing as any,
      googleMaps as any,
      paymentService as any,
      events,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers the ride to the nearest driver first, then cascades after a 15s timeout', async () => {
    jest.spyOn(service, 'findNearbyAvailableDrivers').mockResolvedValue([
      { driverId: 'driver-near', distanceKm: 1 },
      { driverId: 'driver-far', distanceKm: 3 },
    ]);
    const offered: string[] = [];
    events.on('ride.driver_offered', ({ driverId }) => offered.push(driverId));

    await (service as any).startDispatch(ride.id, { lat: ride.pickupLat, lng: ride.pickupLng });
    expect(offered).toEqual(['driver-near']);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(offered).toEqual(['driver-near', 'driver-far']);
  });

  it('stops the cascade once a driver accepts', async () => {
    jest.spyOn(service, 'findNearbyAvailableDrivers').mockResolvedValue([
      { driverId: 'driver-near', distanceKm: 1 },
      { driverId: 'driver-far', distanceKm: 3 },
    ]);
    const offered: string[] = [];
    events.on('ride.driver_offered', ({ driverId }) => offered.push(driverId));

    await (service as any).startDispatch(ride.id, { lat: ride.pickupLat, lng: ride.pickupLng });
    await service.acceptRide(ride.id, 'driver-near');

    await jest.advanceTimersByTimeAsync(30_000);
    expect(offered).toEqual(['driver-near']);
    expect(ride.status).toBe(RideStatus.ACCEPTED);
    expect(ride.driverId).toBe('driver-near');
  });

  it('immediately advances to the next candidate when a driver rejects', async () => {
    jest.spyOn(service, 'findNearbyAvailableDrivers').mockResolvedValue([
      { driverId: 'driver-near', distanceKm: 1 },
      { driverId: 'driver-far', distanceKm: 3 },
    ]);
    const offered: string[] = [];
    events.on('ride.driver_offered', ({ driverId }) => offered.push(driverId));

    await (service as any).startDispatch(ride.id, { lat: ride.pickupLat, lng: ride.pickupLng });
    await service.rejectRide(ride.id, 'driver-near');

    expect(offered).toEqual(['driver-near', 'driver-far']);
  });

  it('throws ConflictException when a non-offered driver tries to accept', async () => {
    jest.spyOn(service, 'findNearbyAvailableDrivers').mockResolvedValue([
      { driverId: 'driver-near', distanceKm: 1 },
    ]);

    await (service as any).startDispatch(ride.id, { lat: ride.pickupLat, lng: ride.pickupLng });

    await expect(service.acceptRide(ride.id, 'driver-not-offered')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('emits ride.no_drivers_found when no candidates are nearby', async () => {
    jest.spyOn(service, 'findNearbyAvailableDrivers').mockResolvedValue([]);
    const handler = jest.fn();
    events.on('ride.no_drivers_found', handler);

    await (service as any).startDispatch(ride.id, { lat: ride.pickupLat, lng: ride.pickupLng });

    expect(handler).toHaveBeenCalledWith({ rideId: ride.id });
  });
});
