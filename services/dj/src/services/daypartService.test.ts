import { describe, it, expect, vi, beforeEach } from 'vitest';
import { daypartService } from './daypartService';
import { getPool } from '../db';

vi.mock('../db', () => ({
  getPool: vi.fn(),
}));

describe('daypartService', () => {
  const mockPool = {
    query: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getPool as any).mockReturnValue(mockPool);
  });

  describe('resolveProfileForHour', () => {
    it('should resolve a profile from a matching daypart assignment', async () => {
      const stationId = 'station-1';
      const hour = 10;
      const dayOfWeek = 'MON';

      // 1. Mock daypart assignment query
      mockPool.query
        .mockResolvedValueOnce({ 
          rows: [{ dj_profile_id: 'profile-1', priority: 1 }] 
        })
        // 2. Mock profile query
        .mockResolvedValueOnce({ 
          rows: [{ id: 'profile-1', name: 'Morning DJ', is_active: true }] 
        });

      const result = await daypartService.resolveProfileForHour(stationId, hour, dayOfWeek);

      expect(result?.name).toBe('Morning DJ');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('dj_daypart_assignments'),
        [stationId, dayOfWeek, hour]
      );
    });

    it('should handle wrap-around dayparts (e.g., 22:00 to 04:00)', async () => {
      const stationId = 'station-1';
      const dayOfWeek = 'MON';

      // Case: hour = 23 (within 22-04)
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ dj_profile_id: 'profile-overnight' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'profile-overnight', name: 'Night Owl' }] });

      const result = await daypartService.resolveProfileForHour(stationId, 23, dayOfWeek);
      expect(result?.name).toBe('Night Owl');

      // Case: hour = 1 (within 22-04)
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ dj_profile_id: 'profile-overnight' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'profile-overnight', name: 'Night Owl' }] });

      const result2 = await daypartService.resolveProfileForHour(stationId, 1, dayOfWeek);
      expect(result2?.name).toBe('Night Owl');
    });

    it('should fallback to default profile if no daypart matches', async () => {
      const stationId = 'station-1';
      
      // 1. Mock daypart assignment query (no match)
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        // 2. Mock default profile query
        .mockResolvedValueOnce({ 
          rows: [{ id: 'profile-default', name: 'Default DJ', is_default: true }] 
        });

      const result = await daypartService.resolveProfileForHour(stationId, 12, 'TUE');

      expect(result?.id).toBe('profile-default');
    });
  });
});
