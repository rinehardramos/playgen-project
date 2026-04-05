export const config = {
  port: Number(process.env.PORT ?? 3007),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  // Redis (BullMQ)
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD ?? undefined,
  },

  // LLM providers
  llm: {
    /** 'openrouter' (default) | 'openai' */
    provider: process.env.LLM_PROVIDER ?? 'openrouter',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  },

  // OpenRouter (LLM via OpenRouter gateway)
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    defaultModel: process.env.LLM_DEFAULT_MODEL ?? 'anthropic/claude-sonnet-4-5',
    siteUrl: process.env.OPENROUTER_SITE_URL ?? 'https://playgen.site',
    siteName: process.env.OPENROUTER_SITE_NAME ?? 'PlayGen',
  },

  // TTS (pluggable via adapter)
  tts: {
    /** 'openai' (default) | 'elevenlabs' | 'google' */
    provider: process.env.TTS_PROVIDER ?? 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY ?? '',
    googleApiKey: process.env.GOOGLE_TTS_API_KEY ?? '',
    defaultVoice: process.env.TTS_DEFAULT_VOICE ?? 'alloy',
  },

  // Storage (local for dev, s3 for prod)
  storage: {
    provider: process.env.STORAGE_PROVIDER ?? 'local',
    localPath: process.env.STORAGE_LOCAL_PATH ?? (process.env.NODE_ENV === 'production' ? '/app/data/audio' : '/tmp/playgen-dj'),
    s3Bucket: process.env.S3_BUCKET ?? '',
    s3Region: process.env.S3_REGION ?? 'us-east-1',
  },

  // JWT (shared secret with auth-service)
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
};
