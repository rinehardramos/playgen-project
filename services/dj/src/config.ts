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
    /** 'openrouter' (default) | 'openai' | 'anthropic' | 'gemini' */
    provider: process.env.LLM_PROVIDER ?? 'openrouter',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
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
    /** 'openai' (default) | 'elevenlabs' | 'google' | 'gemini_tts' | 'mistral' */
    provider: process.env.TTS_PROVIDER ?? 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY ?? '',
    elevenlabsModel: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
    googleApiKey: process.env.GOOGLE_TTS_API_KEY ?? '',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    mistralApiKey: process.env.MISTRAL_API_KEY ?? '',
    narakeetApiKey: process.env.NARAKEET_API_KEY ?? '',
    defaultVoice: process.env.TTS_DEFAULT_VOICE ?? 'alloy',
  },

  // Storage (local for dev, s3 for prod)
  storage: {
    provider: process.env.STORAGE_PROVIDER ?? 'local',
    localPath: process.env.STORAGE_LOCAL_PATH ?? (process.env.NODE_ENV === 'production' ? '/app/data/audio' : '/tmp/playgen-dj'),
    s3Bucket: process.env.S3_BUCKET ?? '',
    s3Region: process.env.S3_REGION ?? 'us-east-1',
    s3Prefix: process.env.S3_PREFIX ?? 'dj-audio',
    s3Endpoint: process.env.S3_ENDPOINT ?? '',          // R2/B2 custom endpoint
    s3PublicUrlBase: process.env.S3_PUBLIC_URL_BASE ?? '', // R2 custom domain for public URLs
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },

  // Audio cleanup
  audioRetentionDays: Number(process.env.AUDIO_RETENTION_DAYS ?? 30),

  // JWT (shared secret with auth-service)
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',

  // Info Broker (optional external data service)
  infoBroker: {
    baseUrl: process.env.INFO_BROKER_BASE_URL ?? '',
    apiKey: process.env.INFO_BROKER_API_KEY ?? '',
    timeoutMs: Number(process.env.INFO_BROKER_TIMEOUT_MS ?? 5000),
  },

  // Social media OAuth (issues #211 Facebook, #212 Twitter)
  social: {
    encryptionKey:       process.env.SOCIAL_TOKEN_ENCRYPTION_KEY ?? '',
    facebookAppId:       process.env.FACEBOOK_APP_ID ?? '',
    facebookAppSecret:   process.env.FACEBOOK_APP_SECRET ?? '',
    twitterClientId:     process.env.TWITTER_CLIENT_ID ?? '',
    twitterClientSecret: process.env.TWITTER_CLIENT_SECRET ?? '',
    callbackBaseUrl:     process.env.SOCIAL_CALLBACK_BASE_URL ?? 'http://localhost:3007/api/v1',
    frontendBaseUrl:     process.env.FRONTEND_BASE_URL ?? 'http://localhost:3000',
  },
};
