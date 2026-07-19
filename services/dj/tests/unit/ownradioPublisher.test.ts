import { describe, it, expect } from 'vitest';
import { isPubliclyPlayable } from '../../src/services/ownradioPublisher.js';

describe('isPubliclyPlayable', () => {
  it('accepts public https cloud URLs', () => {
    expect(isPubliclyPlayable('https://cdn.playgen.site/podcasts/ep.mp3')).toBe(true);
    expect(isPubliclyPlayable('https://pub-abc123.r2.dev/podcasts/ep.mp3?v=1')).toBe(true);
  });

  it('rejects local storage paths and http', () => {
    expect(isPubliclyPlayable('/api/v1/dj/audio/podcasts/ep.mp3')).toBe(false);
    expect(isPubliclyPlayable('http://cdn.example.com/ep.mp3')).toBe(false);
    expect(isPubliclyPlayable(null)).toBe(false);
  });

  it('rejects localhost, raw IPs, and private-suffix hosts', () => {
    expect(isPubliclyPlayable('https://localhost/ep.mp3')).toBe(false);
    expect(isPubliclyPlayable('https://192.168.1.10/ep.mp3')).toBe(false);
    expect(isPubliclyPlayable('https://storage.internal/ep.mp3')).toBe(false);
    expect(isPubliclyPlayable('https://nas.local/ep.mp3')).toBe(false);
  });
});
