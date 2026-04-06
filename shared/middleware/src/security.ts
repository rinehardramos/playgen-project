import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

/**
 * registerSecurity — uniform security plugin registration for every Fastify service.
 *
 * Registers @fastify/helmet with API-appropriate defaults (no CSP — these are
 * JSON APIs, not HTML; CSP belongs on the frontend). HSTS is enabled in
 * production only so local http dev still works.
 *
 * Optionally registers @fastify/rate-limit. Most services already register it
 * directly with their own config, so callers omit `rateLimit` to skip.
 *
 * Returns void synchronously; Fastify's plugin system queues registrations
 * and runs them during `app.ready()`. Call this BEFORE registering routes.
 */
export interface SecurityOptions {
  /** When set, registers a global rate limit for this service. */
  rateLimit?: { max: number; timeWindow: string | number };
  /** Override / extend helmet options. */
  helmet?: Record<string, unknown>;
}

export function registerSecurity(app: FastifyInstance, opts: SecurityOptions = {}): void {
  const isProd = process.env.NODE_ENV === 'production';

  app.register(helmet, {
    // JSON APIs don't render HTML — disable CSP entirely (frontend handles it).
    contentSecurityPolicy: false,
    // Enable HSTS only in production so local http dev still works.
    hsts: isProd
      ? { maxAge: 63072000, includeSubDomains: true, preload: true }
      : false,
    // Sensible defaults for the rest.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
    ...opts.helmet,
  });

  if (opts.rateLimit) {
    app.register(rateLimit, opts.rateLimit);
  }
}
