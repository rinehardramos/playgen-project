import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from '../../src/lib/promptBuilder';
import type { DjProfile } from '@playgen/types';

const mockProfile: DjProfile = {
  id: '11111111-0000-0000-0000-000000000001',
  company_id: '00000000-0000-0000-0000-000000000001',
  name: 'Alex',
  personality: 'Upbeat and charismatic radio DJ who loves music.',
  voice_style: 'energetic',
  llm_model: 'anthropic/claude-sonnet-4-5',
  llm_temperature: 0.8,
  tts_provider: 'openai',
  tts_voice_id: 'alloy',
  is_default: true,
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('buildSystemPrompt', () => {
  it('includes profile name and personality', () => {
    const prompt = buildSystemPrompt(mockProfile);
    expect(prompt).toContain('Alex');
    expect(prompt).toContain('Upbeat and charismatic');
  });

  it('includes voice style', () => {
    const prompt = buildSystemPrompt(mockProfile);
    expect(prompt).toContain('energetic');
  });

  it('includes no-AI disclosure rule', () => {
    const prompt = buildSystemPrompt(mockProfile);
    expect(prompt).toContain('Never break the fourth wall');
  });
});

describe('buildUserPrompt', () => {
  it('interpolates station name in show_intro', () => {
    const prompt = buildUserPrompt({
      station_name: 'WKRP FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-04',
      current_hour: 8,
      dj_profile: mockProfile,
      segment_type: 'show_intro',
    });
    expect(prompt).toContain('WKRP FM');
    expect(prompt).toContain('2026-04-04');
  });

  it('interpolates song info in song_transition', () => {
    const prompt = buildUserPrompt({
      station_name: 'Test FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-04',
      current_hour: 10,
      dj_profile: mockProfile,
      segment_type: 'song_transition',
      prev_song: { title: 'Yesterday', artist: 'The Beatles', duration_sec: 125 },
      next_song: { title: 'Imagine', artist: 'John Lennon', duration_sec: 183 },
    });
    expect(prompt).toContain('Yesterday');
    expect(prompt).toContain('The Beatles');
    expect(prompt).toContain('Imagine');
    expect(prompt).toContain('John Lennon');
  });

  it('uses custom_template when provided', () => {
    const prompt = buildUserPrompt({
      station_name: 'Test FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-04',
      current_hour: 14,
      dj_profile: mockProfile,
      segment_type: 'station_id',
      custom_template: 'You are on {{station_name}} at {{current_hour}} o\'clock!',
    });
    expect(prompt).toContain('You are on Test FM at 14 o\'clock!');
  });

  it('handles missing prev/next song gracefully', () => {
    const prompt = buildUserPrompt({
      station_name: 'Test FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-04',
      current_hour: 6,
      dj_profile: mockProfile,
      segment_type: 'song_intro',
    });
    // Should not throw, empty strings replace missing songs
    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(0);
  });
});
