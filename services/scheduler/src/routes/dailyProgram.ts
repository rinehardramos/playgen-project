import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@playgen/middleware';
import {
  runDailyProgramGenerationForDate,
} from '../jobs/dailyProgramJob';

export async function dailyProgramRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  /**
   * POST /daily-program/generate
   *
   * Trigger daily program generation on demand.
   * Body: { date?: "YYYY-MM-DD" }  — defaults to tomorrow.
   *
   * Returns: { date, queued, skipped }
   */
  app.post('/daily-program/generate', {
    onRequest: [requirePermission('playlist:write')],
  }, async (req) => {
    const { date } = (req.body as { date?: string }) ?? {};

    if (date) {
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw app.httpErrors.badRequest('date must be YYYY-MM-DD format');
      }
      return runDailyProgramGenerationForDate(date);
    }

    // Default: generate for tomorrow
    return runDailyProgramGenerationForDate();
  });

  /**
   * POST /daily-program/generate-today
   *
   * Convenience: generate for today (useful for testing / catch-up).
   */
  app.post('/daily-program/generate-today', {
    onRequest: [requirePermission('playlist:write')],
  }, async () => {
    const today = new Date().toISOString().slice(0, 10);
    return runDailyProgramGenerationForDate(today);
  });
}
