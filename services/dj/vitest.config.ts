import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@playgen/types': path.resolve(__dirname, '../../shared/types/src/index.ts'),
      '@playgen/middleware': path.resolve(__dirname, '../../shared/middleware/src/index.ts'),
      '@playgen/storage': path.resolve(__dirname, '../../shared/storage/src/index.ts'),
      // Force consistent @aws-sdk resolution: shared/storage pins v3.1035 but tests run
      // from services/dj which sees v3.1041 at root. Without this alias vi.mock registers
      // the root version while s3Storage.ts imports the shared/storage version — different
      // physical modules — so the mock never intercepts the real SDK calls.
      '@aws-sdk/client-s3': path.resolve(__dirname, '../../node_modules/@aws-sdk/client-s3'),
    },
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
