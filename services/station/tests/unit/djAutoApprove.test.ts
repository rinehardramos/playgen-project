/**
 * Unit tests for dj_auto_approve toggle via updateStation (issue #33)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({
    query: mockQuery,
  })),
}));

import * as stationService from '../../src/services/stationService';

describe('stationService — dj_auto_approve toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables auto-approve by updating dj_auto_approve = true', async () => {
    const updatedStation = {
      id: 'station-1',
      name: 'Test FM',
      dj_auto_approve: true,
      dj_enabled: false,
    };
    mockQuery.mockResolvedValueOnce({ rows: [updatedStation] });

    const result = await stationService.updateStation('station-1', { dj_auto_approve: true });

    expect(result?.dj_auto_approve).toBe(true);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('dj_auto_approve = $');
    const values = mockQuery.mock.calls[0][1] as unknown[];
    expect(values).toContain(true);
  });

  it('disables auto-approve by updating dj_auto_approve = false', async () => {
    const updatedStation = {
      id: 'station-1',
      name: 'Test FM',
      dj_auto_approve: false,
    };
    mockQuery.mockResolvedValueOnce({ rows: [updatedStation] });

    const result = await stationService.updateStation('station-1', { dj_auto_approve: false });

    expect(result?.dj_auto_approve).toBe(false);
    const values = mockQuery.mock.calls[0][1] as unknown[];
    expect(values).toContain(false);
  });

  it('returns station unchanged when no update fields are provided', async () => {
    const existing = { id: 'station-1', name: 'Test FM', dj_auto_approve: false };
    mockQuery.mockResolvedValueOnce({ rows: [existing] });

    const result = await stationService.updateStation('station-1', {});
    // When no fields are updated, getStation is called (SELECT query)
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('SELECT');
    expect(result).not.toBeNull();
  });
});
