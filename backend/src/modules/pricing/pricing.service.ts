import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FareBreakdown {
  priceAriary: number;
  surgeMultiplier: number;
}

interface PeakHourRange {
  start: number;
  end: number;
}

@Injectable()
export class PricingService {
  constructor(private readonly config: ConfigService) {}

  calculateFare(distanceKm: number, durationMin: number, at: Date = new Date()): FareBreakdown {
    const baseFare = Number(this.config.get('RIDE_BASE_FARE_MGA') ?? 2000);
    const pricePerKm = Number(this.config.get('RIDE_PRICE_PER_KM_MGA') ?? 1500);
    const pricePerMin = Number(this.config.get('RIDE_PRICE_PER_MIN_MGA') ?? 200);

    const surgeMultiplier = this.getSurgeMultiplier(at);
    const subtotal = baseFare + distanceKm * pricePerKm + durationMin * pricePerMin;
    const priceAriary = Math.round(subtotal * surgeMultiplier);

    return { priceAriary, surgeMultiplier };
  }

  private getSurgeMultiplier(at: Date): number {
    if (!this.isPeakHour(at)) {
      return 1;
    }
    return Number(this.config.get('RIDE_SURGE_MULTIPLIER') ?? 1.5);
  }

  private isPeakHour(at: Date): boolean {
    const ranges = this.parsePeakHourRanges(
      String(this.config.get('RIDE_SURGE_PEAK_HOURS') ?? '7-9,17-19'),
    );
    const hour = at.getHours();
    return ranges.some(({ start, end }) => hour >= start && hour < end);
  }

  private parsePeakHourRanges(raw: string): PeakHourRange[] {
    return raw
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const [start, end] = segment.split('-').map(Number);
        return { start, end };
      })
      .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end));
  }
}
