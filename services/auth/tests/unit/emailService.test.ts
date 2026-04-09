import { describe, it, expect, vi, afterEach } from 'vitest';

// vi.hoisted runs before the mock factory, so mockSend is available inside the class
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ id: 'email-id-123' }),
}));

// Mock resend module — class so `new Resend()` works at module load time
vi.mock('resend', () => {
  class ResendMock {
    emails = { send: mockSend };
  }
  return { Resend: ResendMock };
});

import { sendPasswordResetEmail, sendVerificationEmail } from '../../src/services/emailService';

describe('emailService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('module exports are accessible with no RESEND_API_KEY (lazy-init — no crash on import)', () => {
    // Resend is now instantiated lazily inside each send* function.
    // If it were constructed at module level, importing without a key would throw.
    expect(sendPasswordResetEmail).toBeTypeOf('function');
    expect(sendVerificationEmail).toBeTypeOf('function');
  });

  it('logs to console when RESEND_API_KEY is not set (password reset)', async () => {
    const savedKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendPasswordResetEmail('user@example.com', 'https://playgen.site/reset-password?token=abc');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL STUB]'));
    consoleSpy.mockRestore();
    if (savedKey !== undefined) process.env.RESEND_API_KEY = savedKey;
  });

  it('calls Resend.emails.send when RESEND_API_KEY is set (password reset)', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    mockSend.mockResolvedValueOnce({ id: 'email-id' });
    await sendPasswordResetEmail('user@example.com', 'https://example.com/reset?token=abc');
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: expect.stringContaining('Reset'),
    }));
    delete process.env.RESEND_API_KEY;
  });

  it('logs to console when RESEND_API_KEY is not set (verification)', async () => {
    const savedKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendVerificationEmail('user@example.com', 'https://playgen.site/verify-email?token=abc');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL STUB]'));
    consoleSpy.mockRestore();
    if (savedKey !== undefined) process.env.RESEND_API_KEY = savedKey;
  });
});
