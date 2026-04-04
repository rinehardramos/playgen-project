import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.APP_URL = 'http://localhost:3000';
});

const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import { createInvite } from '../../src/services/inviteService';

describe('createInvite', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('throws if role not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      createInvite({
        companyId: 'company-001',
        invitedBy: 'admin-001',
        email: 'new@example.com',
        roleId: 'nonexistent-role',
        stationIds: [],
      })
    ).rejects.toMatchObject({ code: 'INVALID_ROLE' });
  });

  it('creates invite and returns invite_link containing accept-invite token', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'role-001' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'invite-001', expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }],
      });

    const result = await createInvite({
      companyId: 'company-001',
      invitedBy: 'admin-001',
      email: 'new@example.com',
      roleId: 'role-001',
      stationIds: ['station-001'],
    });

    expect(result.invite_link).toContain('/accept-invite?token=');
    expect(result.email).toBe('new@example.com');
    expect(result.id).toBe('invite-001');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('accept-invite?token='));
    consoleSpy.mockRestore();
  });

  it('lower-cases the email before storing', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'role-001' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'invite-001', expires_at: new Date() }],
      });

    const result = await createInvite({
      companyId: 'company-001',
      invitedBy: 'admin-001',
      email: 'NEW@EXAMPLE.COM',
      roleId: 'role-001',
      stationIds: [],
    });

    expect(result.email).toBe('new@example.com');

    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1]).toContain('new@example.com');

    consoleSpy.mockRestore();
  });
});
