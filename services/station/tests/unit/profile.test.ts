import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';

const mockQuery = vi.fn();
vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({
    query: mockQuery,
  })),
}));

import * as userService from '../../src/services/userService';

describe('userService — self-service profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates only display_name when password is not provided', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-1', display_name: 'New Name', role_code: 'admin', role_label: 'Admin' }],
    });

    const result = await userService.updateUserProfile('user-1', {
      display_name: 'New Name',
    });

    expect(result?.display_name).toBe('New Name');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET display_name = $1'),
      ['New Name', 'user-1']
    );
  });

  it('hashes and updates password when provided', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-1', display_name: 'User', role_code: 'admin', role_label: 'Admin' }],
    });

    await userService.updateUserProfile('user-1', {
      password: 'new-password-123',
    });

    // Check that password_hash was in the query
    const lastCall = mockQuery.mock.calls[0];
    const query = lastCall[0];
    const params = lastCall[1];

    expect(query).toContain('password_hash = $1');
    expect(params[1]).toBe('user-1');
    
    // Verify the hash (bcrypt async)
    const isValid = await bcrypt.compare('new-password-123', params[0]);
    expect(isValid).toBe(true);
  });

  it('returns current user if no data provided', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-1', display_name: 'Old Name', role_code: 'admin', role_label: 'Admin' }],
    });

    const result = await userService.updateUserProfile('user-1', {});
    
    expect(result?.display_name).toBe('Old Name');
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE'), expect.any(Array));
  });
});
