import { FastifyInstance } from 'fastify';
import { authenticate, requireStationAccess } from '@playgen/middleware';
import { scriptTemplateService } from '../services/scriptTemplateService';
import { ScriptSegmentType } from '@playgen/types';

export async function scriptTemplateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireStationAccess());

  app.get('/stations/:station_id/dj/script-templates', async (req) => {
    const { station_id } = req.params as { station_id: string };
    return scriptTemplateService.list(station_id);
  });

  app.post('/stations/:station_id/dj/script-templates', async (req, reply) => {
    const { station_id } = req.params as { station_id: string };
    const { segment_type, prompt_template } = req.body as { 
      segment_type: ScriptSegmentType; 
      prompt_template: string 
    };
    
    if (!segment_type || !prompt_template) {
      return reply.badRequest('segment_type and prompt_template are required');
    }

    const template = await scriptTemplateService.upsert(station_id, segment_type, prompt_template);
    return reply.code(201).send(template);
  });

  app.delete('/stations/:station_id/dj/script-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await scriptTemplateService.delete(id);
    return reply.code(204).send();
  });
}
