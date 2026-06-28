import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface CachedRate {
  rate: number;
  expiresAt: number;
}

@Injectable()
export class ExchangeRateService {
  private readonly ttlMs = 60 * 60 * 1000;
  private cache: CachedRate | null = null;

  constructor(private readonly config: ConfigService) {}

  async getMgaToUsdRate(): Promise<number> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.rate;
    }

    const apiKey = this.config.getOrThrow<string>('EXCHANGE_RATE_API_KEY');
    const { data } = await axios.get(
      `https://v6.exchangerate-api.com/v6/${apiKey}/pair/MGA/USD`,
    );

    if (typeof data?.conversion_rate !== 'number') {
      throw new InternalServerErrorException('Unable to retrieve MGA/USD exchange rate');
    }

    this.cache = { rate: data.conversion_rate, expiresAt: Date.now() + this.ttlMs };
    return this.cache.rate;
  }

  async convertMgaToUsd(amountMga: number): Promise<number> {
    const rate = await this.getMgaToUsdRate();
    return Math.round(amountMga * rate * 100) / 100;
  }
}
