import { haversineDistanceKm } from '../geo.util';

describe('geo.util', () => {
  describe('haversineDistanceKm', () => {
    it('returns 0 for identical points', () => {
      expect(haversineDistanceKm({ lat: -18.8792, lng: 47.5079 }, { lat: -18.8792, lng: 47.5079 })).toBe(0);
    });

    it('returns ~111km for 1 degree of longitude at the equator', () => {
      const distance = haversineDistanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
      expect(distance).toBeGreaterThan(110);
      expect(distance).toBeLessThan(112);
    });

    it('computes the distance between two Antananarivo landmarks', () => {
      const distance = haversineDistanceKm({ lat: -18.8792, lng: 47.5079 }, { lat: -18.9101, lng: 47.5255 });
      expect(distance).toBeGreaterThan(3);
      expect(distance).toBeLessThan(5);
    });
  });
});
