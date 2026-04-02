import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireStationAccess } from '@playgen/middleware';
import * as analyticsService from '../services/analyticsService';

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate);

  // ── GET /stations/:id/analytics/heatmap?days=14 ───────────────────────────
  app.get('/stations/:id/analytics/heatmap', {
    onRequest: [requirePermission('analytics:read'), requireStationAccess()],
  }, async (req) => {
    const { id } = req.params as { id: string };
    const query = req.query as { days?: string };
    const days = query.days ? parseInt(query.days, 10) : 14;
    return analyticsService.getRotationHeatmap(id, days);
  });

  // ── GET /stations/:id/analytics/overplayed ────────────────────────────────
  app.get('/stations/:id/analytics/overplayed', {
    onRequest: [requirePermission('analytics:read'), requireStationAccess()],
  }, async (req) => {
    const { id } = req.params as { id: string };
    return analyticsService.getOverplayedSongs(id);
  });

  // ── GET /stations/:id/analytics/underplayed ───────────────────────────────
  app.get('/stations/:id/analytics/underplayed', {
    onRequest: [requirePermission('analytics:read'), requireStationAccess()],
  }, async (req) => {
    const { id } = req.params as { id: string };
    return analyticsService.getUnderplayedSongs(id);
  });

  // ── GET /stations/:id/analytics/category-distribution?days=7 ─────────────
  app.get('/stations/:id/analytics/category-distribution', {
    onRequest: [requirePermission('analytics:read'), requireStationAccess()],
  }, async (req) => {
    const { id } = req.params as { id: string };
    const query = req.query as { days?: string };
    const days = query.days ? parseInt(query.days, 10) : 7;
    return analyticsService.getCategoryDistribution(id, days);
  });

  // ── GET /songs/:id/history?limit=30 ──────────────────────────────────────
  app.get('/songs/:id/history', {
    onRequest: [requirePermission('library:read')],
  }, async (req) => {
    const { id } = req.params as { id: string };
    const query = req.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 30;
    return analyticsService.getSongHistory(id, limit);
  });
}
