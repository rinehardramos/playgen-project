import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: Number(process.env.DJ_SERVICE_PORT ?? 3007),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  
  postgres: {
    url: process.env.DATABASE_URL,
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    db: process.env.POSTGRES_DB ?? 'playgen',
    user: process.env.POSTGRES_USER ?? 'playgen',
    password: process.env.POSTGRES_PASSWORD ?? 'changeme',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },

  llm: {
    provider: process.env.DJ_LLM_PROVIDER ?? 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.DJ_LLM_MODEL ?? 'anthropic/claude-3-5-sonnet',
  },

  tts: {
    openaiApiKey: process.env.OPENAI_API_KEY,
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
  },

  storage: {
    provider: process.env.DJ_STORAGE_PROVIDER ?? 'local',
    localPath: process.env.DJ_STORAGE_LOCAL_PATH ?? path.join(process.cwd(), 'data/audio'),
  },
};
