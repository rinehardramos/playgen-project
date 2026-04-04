import { DJProfile } from '@playgen/types';

export interface PromptContext {
  djProfile: DJProfile;
  stationName: string;
  hour: number;
  timeOfDay: string;
  date: string;
  time: string;
  currentSong?: { title: string; artist: string };
  nextSong?: { title: string; artist: string };
  prevSong?: { title: string; artist: string };
}

export const promptBuilder = {
  buildSystemPrompt(profile: DJProfile): string {
    return `
You are ${profile.name}, a radio DJ.
Your tone is ${profile.tone} and your energy level is ${profile.energy_level}.
${profile.persona_prompt}
Use these catchphrases occasionally: ${profile.catchphrases.join(', ')}.
Keep your commentary concise, engaging, and suitable for broadcast.
Do not use emojis or stage directions. Only output the spoken text.
`.trim();
  },

  buildUserPrompt(template: string, context: PromptContext): string {
    const variables: Record<string, string | undefined> = {
      dj_name: context.djProfile.name,
      station_name: context.stationName,
      hour: context.hour.toString(),
      time_of_day: context.timeOfDay,
      date: context.date,
      time: context.time,
      song_title: context.currentSong?.title,
      artist: context.currentSong?.artist,
      next_song: context.nextSong?.title,
      next_artist: context.nextSong?.artist,
      prev_song: context.prevSong?.title,
      prev_artist: context.prevSong?.artist,
    };

    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, value || '');
    }

    return result;
  }
};
