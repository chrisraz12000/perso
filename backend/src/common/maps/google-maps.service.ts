import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GeoPoint } from '../utils/geo.util';

export interface RouteEstimate {
  distanceKm: number;
  durationMin: number;
}

interface DistanceMatrixResponse {
  rows: Array<{
    elements: Array<{
      status: string;
      distance?: { value: number };
      duration?: { value: number };
    }>;
  }>;
}

@Injectable()
export class GoogleMapsService {
  constructor(private readonly config: ConfigService) {}

  async getRoute(origin: GeoPoint, destination: GeoPoint): Promise<RouteEstimate> {
    const apiKey = this.config.getOrThrow<string>('GOOGLE_MAPS_API_KEY');

    const { data } = await axios.get<DistanceMatrixResponse>(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
      {
        params: {
          origins: `${origin.lat},${origin.lng}`,
          destinations: `${destination.lat},${destination.lng}`,
          key: apiKey,
        },
      },
    );

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK' || !element.distance || !element.duration) {
      throw new BadGatewayException('Unable to estimate route from Google Maps');
    }

    return {
      distanceKm: element.distance.value / 1000,
      durationMin: element.duration.value / 60,
    };
  }
}
