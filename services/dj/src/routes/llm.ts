import { FastifyInstance } from 'fastify';
import { getLLMAdapter } from '../adapters/llm/registry';

export async function llmRoutes(app: FastifyInstance) {
  app.get('/dj/llm/models', async (req, reply) => {
    try {
      const provider = (req.query as any).provider;
      const adapter = getLLMAdapter(provider);
      const models = await adapter.listModels();
      return { models };
    } catch (err: any) {
      req.log.error(err);
      return reply.code(500).send({ 
        error: { code: 'LLM_ERROR', message: err.message } 
      });
    }
  });
}
