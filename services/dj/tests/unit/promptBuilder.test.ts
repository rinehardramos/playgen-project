import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt } from '../../src/lib/promptBuilder';
import type { DjProfile } from '@playgen/types';

const mockProfile: DjProfile = {
  id: '11111111-0000-0000-0000-000000000001',
  company_id: '00000000-0000-0000-0000-000000000001',
  name: 'Alex',
  personality: 'Upbeat and charismatic radio DJ who loves music.',
  voice_style: 'energetic',
  persona_config: {},
  llm_model: 'anthropic/claude-sonnet-4-5',
  llm_temperature: 0.8,
  tts_provider: 'openai',
  tts_voice_id: 'alloy',
  is_default: true,
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

const richProfile: DjProfile = {
  ...mockProfile,
  persona_config: {
    catchphrases: ['Keep it locked!', "That's what I'm talking about!"],
    signature_greeting: 'Hey hey, you are live with Alex!',
    signature_signoff: 'Stay tuned, stay awesome.',
    topics_to_avoid: ['politics', 'religion'],
    energy_level: 8,
    humor_level: 5,
    formality: 'casual',
    backstory: 'Alex started as a college radio intern a decade ago.',
  },
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

  it('works with empty persona_config', () => {
    const prompt = buildSystemPrompt(mockProfile);
    expect(prompt).not.toContain('Character traits:');
    expect(prompt).toContain('Alex');
  });

  it('includes catchphrases from persona_config', () => {
    const prompt = buildSystemPrompt(richProfile);
    expect(prompt).toContain('Keep it locked!');
    expect(prompt).toContain("That's what I'm talking about!");
    expect(prompt).toContain('signature phrases');
  });

  it('includes signature greeting and signoff', () => {
    const prompt = buildSystemPrompt(richProfile);
    expect(prompt).toContain('Hey hey, you are live with Alex!');
    expect(prompt).toContain('Stay tuned, stay awesome.');
  });

  it('includes topics to avoid', () => {
    const prompt = buildSystemPrompt(richProfile);
    expect(prompt).toContain('NEVER discuss');
    expect(prompt).toContain('politics');
    expect(prompt).toContain('religion');
  });

  it('includes energy level description', () => {
    const prompt = buildSystemPrompt(richProfile);
    expect(prompt).toContain('high energy');
  });

  it('includes humor level description', () => {
    const prompt = buildSystemPrompt(richProfile);
    expect(prompt).toContain('light humor');
  });

  it('includes formality description', () => {
    const prompt = buildSystemPrompt(richProfile);
    expect(prompt).toContain('casually');
  });

  it('includes backstory', () => {
    const prompt = buildSystemPrompt(richProfile);
    expect(prompt).toContain('college radio intern');
  });

  it('includes Character traits section header when config is populated', () => {
    const prompt = buildSystemPrompt(richProfile);
    expect(prompt).toContain('Character traits:');
  });
});

describe('buildUserPrompt', () => {
  it('interpolates station name in show_intro', () => {
    const prompt = buildUserPrompt({
      station_name: 'WKRP FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-04',
      current_hour: 8,
      current_time_formatted: '8:00 AM',
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
      current_time_formatted: '10:00 AM',
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
      current_time_formatted: '2:00 PM',
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
      current_time_formatted: '6:00 AM',
      dj_profile: mockProfile,
      segment_type: 'song_intro',
    });
    expect(prompt).toBeDefined();
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('interpolates news headlines in current_events', () => {
    const prompt = buildUserPrompt({
      station_name: 'Test FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-06',
      current_hour: 9,
      dj_profile: mockProfile,
      segment_type: 'current_events',
      news_headlines: [
        { title: 'City opens new park', source: 'Local News' },
        { title: 'Weekend rain expected', source: 'Weather' },
      ],
    });
    expect(prompt).toContain('City opens new park');
    expect(prompt).toContain('Local News');
  });

  it('falls back gracefully for current_events with no headlines', () => {
    const prompt = buildUserPrompt({
      station_name: 'Test FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-06',
      current_hour: 9,
      dj_profile: mockProfile,
      segment_type: 'current_events',
    });
    expect(prompt).toContain('no current headlines available');
  });

  it('interpolates listener shoutout in listener_activity', () => {
    const prompt = buildUserPrompt({
      station_name: 'Test FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-06',
      current_hour: 10,
      dj_profile: mockProfile,
      segment_type: 'listener_activity',
      shoutout: { listener_name: 'Maria from Manila', listener_message: 'Love the show!' },
    });
    expect(prompt).toContain('Maria from Manila');
    expect(prompt).toContain('Love the show!');
  });

  it('uses fallback name for listener_activity when name is missing', () => {
    const prompt = buildUserPrompt({
      station_name: 'Test FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-06',
      current_hour: 10,
      dj_profile: mockProfile,
      segment_type: 'listener_activity',
      shoutout: { listener_name: null, listener_message: 'Great tunes!' },
    });
    expect(prompt).toContain('a listener');
    expect(prompt).toContain('Great tunes!');
  });

  it('interpolates current_time_formatted in time_check', () => {
    const prompt = buildUserPrompt({
      station_name: 'Test FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-06',
      current_hour: 14,
      current_time_formatted: '2:30 PM',
      dj_profile: mockProfile,
      segment_type: 'time_check',
    });
    expect(prompt).toContain('2:30 PM');
    expect(prompt).toContain('Test FM');
  });

  it('uses joke template with station name', () => {
    const prompt = buildUserPrompt({
      station_name: 'Test FM',
      station_timezone: 'Asia/Manila',
      current_date: '2026-04-06',
      current_hour: 10,
      current_time_formatted: '10:00 AM',
      dj_profile: mockProfile,
      segment_type: 'joke',
    });
    expect(prompt).toContain('Test FM');
  });
});
