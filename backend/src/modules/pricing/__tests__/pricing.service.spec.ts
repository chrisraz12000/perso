import { ConfigService } from '@nestjs/config';
import { PricingService } from '../pricing.service';

function buildConfig(values: Record<string, string | number> = {}): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('PricingService', () => {
  it('applies base fare, per-km, and per-minute pricing with no surge off-peak', () => {
    const service = new PricingService(
      buildConfig({
        RIDE_BASE_FARE_MGA: 2000,
        RIDE_PRICE_PER_KM_MGA: 1500,
        RIDE_PRICE_PER_MIN_MGA: 200,
        RIDE_SURGE_MULTIPLIER: 1.5,
        RIDE_SURGE_PEAK_HOURS: '7-9,17-19',
      }),
    );

    const offPeak = new Date('2026-06-28T12:00:00');
    const fare = service.calculateFare(10, 20, offPeak);

    expect(fare.surgeMultiplier).toBe(1);
    expect(fare.priceAriary).toBe(2000 + 10 * 1500 + 20 * 200);
  });

  it('applies the surge multiplier during configured peak hours', () => {
    const service = new PricingService(
      buildConfig({
        RIDE_BASE_FARE_MGA: 2000,
        RIDE_PRICE_PER_KM_MGA: 1500,
        RIDE_PRICE_PER_MIN_MGA: 200,
        RIDE_SURGE_MULTIPLIER: 1.5,
        RIDE_SURGE_PEAK_HOURS: '7-9,17-19',
      }),
    );

    const peak = new Date('2026-06-28T18:00:00');
    const fare = service.calculateFare(10, 20, peak);

    expect(fare.surgeMultiplier).toBe(1.5);
    expect(fare.priceAriary).toBe(Math.round((2000 + 10 * 1500 + 20 * 200) * 1.5));
  });

  it('falls back to sensible defaults when config values are missing', () => {
    const service = new PricingService(buildConfig());
    const fare = service.calculateFare(5, 10, new Date('2026-06-28T12:00:00'));
    expect(fare.priceAriary).toBeGreaterThan(0);
  });
});
