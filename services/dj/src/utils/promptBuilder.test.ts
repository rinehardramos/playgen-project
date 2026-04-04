import { describe, it, expect } from 'vitest';
import { promptBuilder, PromptContext } from './promptBuilder';
import { DJProfile } from '@playgen/types';

describe('promptBuilder', () => {
  const mockProfile: DJProfile = {
    id: '1',
    station_id: 's1',
    name: 'Alex',
    persona_prompt: 'Professional DJ.',
    tone: 'Friendly',
    energy_level: 'High',
    catchphrases: ['Keep it real', 'Rock on'],
    voice_config: { provider: 'openai', voice_id: 'nova' },
    is_default: true,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockContext: PromptContext = {
    djProfile: mockProfile,
    stationName: 'PlayGen FM',
    hour: 14,
    timeOfDay: 'afternoon',
    date: '2026-04-04',
    time: '2:00 PM',
    currentSong: { title: 'Bohemian Rhapsody', artist: 'Queen' },
    nextSong: { title: 'Imagine', artist: 'John Lennon' },
    prevSong: { title: 'Thriller', artist: 'Michael Jackson' },
  };

  describe('buildSystemPrompt', () => {
    it('should include profile name and persona details', () => {
      const prompt = promptBuilder.buildSystemPrompt(mockProfile);
      expect(prompt).toContain('Alex');
      expect(prompt).toContain('Friendly');
      expect(prompt).toContain('High');
      expect(prompt).toContain('Professional DJ.');
      expect(prompt).toContain('Keep it real, Rock on');
    });
  });

  describe('buildUserPrompt', () => {
    it('should interpolate all variables correctly', () => {
      const template = "Hi, I'm {{dj_name}} on {{station_name}}. It's {{time}} on this {{time_of_day}}. That was {{prev_song}} by {{prev_artist}}. Now playing {{song_title}} by {{artist}}, with {{next_song}} by {{next_artist}} coming up next!";
      
      const result = promptBuilder.buildUserPrompt(template, mockContext);
      
      expect(result).toBe("Hi, I'm Alex on PlayGen FM. It's 2:00 PM on this afternoon. That was Thriller by Michael Jackson. Now playing Bohemian Rhapsody by Queen, with Imagine by John Lennon coming up next!");
    });

    it('should handle missing optional songs', () => {
      const contextWithoutSongs: PromptContext = { ...mockContext, currentSong: undefined, nextSong: undefined, prevSong: undefined };
      const template = "Playing {{song_title}} next is {{next_song}}";
      
      const result = promptBuilder.buildUserPrompt(template, contextWithoutSongs);
      expect(result).toBe("Playing  next is ");
    });
  });
});
