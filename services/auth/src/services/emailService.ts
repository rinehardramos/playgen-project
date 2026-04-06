import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || 're_stub_noop_key');
const FROM = process.env.EMAIL_FROM ?? 'PlayGen <noreply@playgen.site>';

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[EMAIL STUB] Password reset for ${to}: ${resetLink}`);
    return;
  }
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Reset your PlayGen password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0b0b10;color:#e5e5e5;border-radius:12px">
        <h1 style="font-size:22px;font-weight:700;color:#fff;margin-bottom:8px">Reset your password</h1>
        <p style="color:#9ca3af;margin-bottom:24px">Click the button below to reset your PlayGen password. This link expires in <strong style="color:#e5e5e5">1 hour</strong>.</p>
        <a href="${resetLink}" style="display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Reset Password</a>
        <p style="margin-top:24px;color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #2a2a40;margin:24px 0"/>
        <p style="color:#4b5563;font-size:12px">PlayGen · Radio Playlist Manager</p>
      </div>`,
  });
}

export async function sendVerificationEmail(to: string, verifyLink: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[EMAIL STUB] Verify email for ${to}: ${verifyLink}`);
    return;
  }
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Verify your PlayGen email address',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0b0b10;color:#e5e5e5;border-radius:12px">
        <h1 style="font-size:22px;font-weight:700;color:#fff;margin-bottom:8px">Verify your email</h1>
        <p style="color:#9ca3af;margin-bottom:24px">Click the button below to verify your PlayGen email address. This link expires in <strong style="color:#e5e5e5">24 hours</strong>.</p>
        <a href="${verifyLink}" style="display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Verify Email</a>
        <p style="margin-top:24px;color:#6b7280;font-size:13px">If you didn't create a PlayGen account, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #2a2a40;margin:24px 0"/>
        <p style="color:#4b5563;font-size:12px">PlayGen · Radio Playlist Manager</p>
      </div>`,
  });
}
