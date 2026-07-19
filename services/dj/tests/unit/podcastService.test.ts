import { describe, it, expect } from 'vitest';
import { validateHosts, normalizeScript, type PodcastHost } from '../../src/services/podcastService.js';

const alex: PodcastHost = { name: 'Alex', provider: 'mistral', voice_id: 'en_paul_cheerful' };
const sam: PodcastHost = { name: 'Sam', provider: 'elevenlabs', voice_id: 'cloned-voice-123' };

describe('validateHosts', () => {
  it('accepts two hosts with distinct names and supported providers', () => {
    expect(validateHosts([alex, sam])).toBeNull();
  });

  it('rejects anything but exactly two hosts', () => {
    expect(validateHosts([alex])).toMatch(/exactly 2/);
    expect(validateHosts([alex, sam, { ...sam, name: 'Third' }])).toMatch(/exactly 2/);
    expect(validateHosts(undefined)).toMatch(/exactly 2/);
  });

  it('rejects unsupported providers', () => {
    expect(validateHosts([alex, { ...sam, provider: 'winamp' }])).toMatch(/provider must be one of/);
  });

  it('rejects missing names and voice ids', () => {
    expect(validateHosts([{ ...alex, name: ' ' }, sam])).toMatch(/needs a name/);
    expect(validateHosts([alex, { ...sam, voice_id: '' }])).toMatch(/needs a voice_id/);
  });

  it('rejects duplicate host names (case-insensitive)', () => {
    expect(validateHosts([alex, { ...sam, name: 'alex' }])).toMatch(/distinct names/);
  });
});

describe('normalizeScript', () => {
  it('keeps tagged dialogue as-is', () => {
    const script = '[Alex] Hello!\n[Sam] Hi there.';
    expect(normalizeScript(script, [alex, sam])).toBe(script);
  });

  it('alternates plain paragraphs between the two hosts', () => {
    const out = normalizeScript('First line.\n\nSecond line.\n\nThird line.', [alex, sam]);
    expect(out.split('\n')).toEqual([
      '[Alex] First line.',
      '[Sam] Second line.',
      '[Alex] Third line.',
    ]);
  });

  it('drops empty lines when alternating', () => {
    const out = normalizeScript('One.\n\n\n\nTwo.', [alex, sam]);
    expect(out).toBe('[Alex] One.\n[Sam] Two.');
  });
});
