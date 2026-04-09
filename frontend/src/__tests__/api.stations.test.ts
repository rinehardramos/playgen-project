import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch before importing api
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock sessionStorage
vi.stubGlobal('sessionStorage', {
  getItem: vi.fn(() => 'test-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

describe('api.stations.list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 'stn-1', name: 'Station 1' }],
    });
  });

  it('calls /api/v1/companies/:companyId/stations — not the flat /stations endpoint', async () => {
    const { api } = await import('../lib/api');
    await api.stations.list('company-abc');

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl: string = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v1/companies/company-abc/stations');
    expect(calledUrl).not.toMatch(/\/api\/v1\/stations$/);
  });

  it('returns the stations array from the response', async () => {
    const { api } = await import('../lib/api');
    const result = await api.stations.list('company-abc');
    expect(result).toEqual([{ id: 'stn-1', name: 'Station 1' }]);
  });
});
