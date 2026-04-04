import { PlaylistEntry, ScriptSegmentType } from '@playgen/types';
import { daypartService } from './daypartService';
import { scriptTemplateService } from './scriptTemplateService';
import { promptBuilder, PromptContext } from '../utils/promptBuilder';
import { getLLMAdapter } from '../adapters/llm/registry';
import { scriptService } from './scriptService';
import { getPool } from '../db';

export const scriptGenerator = {
  async generateForPlaylist(scriptId: string): Promise<void> {
    const script = await scriptService.getScript(scriptId);
    if (!script) throw new Error('Script not found');

    try {
      await scriptService.updateScriptStatus(scriptId, 'generating_scripts');

      const { station_id, playlist_id } = script;

      // 1. Fetch playlist entries
      // In a real app, this would be an internal API call to playlist-service
      const { rows: entries } = await getPool().query(
        'SELECT * FROM playlist_entries WHERE playlist_id = $1 ORDER BY hour ASC, position ASC',
        [playlist_id]
      );

      // 2. Fetch station name (needed for context)
      const { rows: stations } = await getPool().query(
        'SELECT name FROM stations WHERE id = $1',
        [station_id]
      );
      const stationName = stations[0]?.name || 'PlayGen FM';

      const adapter = getLLMAdapter();

      // 3. Process entries hour by hour to generate segments
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const nextEntry = entries[i + 1];
        const prevEntry = entries[i - 1];

        // For now, let's just generate a 'segue' for every song transition
        // And a 'show_open' for the first song
        const segmentTypes: ScriptSegmentType[] = [];
        if (i === 0) segmentTypes.push('show_open');
        segmentTypes.push('segue');

        for (const type of segmentTypes) {
          const profile = await daypartService.resolveProfileForHour(
            station_id, 
            entry.hour, 
            'MON' // TODO: Get actual day of week from playlist date
          );

          if (!profile) continue;

          const template = await scriptTemplateService.getTemplateForSegment(station_id, type);
          if (!template) continue;

          // Fetch song titles for context
          const currentSong = await this.getSongInfo(entry.song_id);
          const nextSong = nextEntry ? await this.getSongInfo(nextEntry.song_id) : undefined;
          const prevSong = prevEntry ? await this.getSongInfo(prevEntry.song_id) : undefined;

          const context: PromptContext = {
            djProfile: profile,
            stationName,
            hour: entry.hour,
            timeOfDay: this.getTimeOfDay(entry.hour),
            date: '2026-04-04', // TODO: From playlist
            time: `${entry.hour}:00`,
            currentSong,
            nextSong,
            prevSong,
          };

          const systemPrompt = promptBuilder.buildSystemPrompt(profile);
          const userPrompt = promptBuilder.buildUserPrompt(template, context);

          const response = await adapter.generateText({
            prompt: userPrompt,
            systemPrompt,
          });

          await scriptService.createSegment({
            dj_script_id: scriptId,
            dj_profile_id: profile.id,
            segment_type: type,
            script_text: response.text,
            audio_file_path: null,
            audio_duration_ms: null,
            before_song_id: entry.id, // Play segment before this song
            after_song_id: prevEntry?.id || null,
          });
        }
      }

      await scriptService.updateScriptStatus(scriptId, 'pending_review');
    } catch (err: any) {
      console.error('Script generation failed:', err);
      await scriptService.updateScriptStatus(scriptId, 'failed', err.message);
      throw err;
    }
  },

  async regenerateSegment(segmentId: string): Promise<string> {
    const segment = await scriptService.getSegment(segmentId);
    if (!segment) throw new Error('Segment not found');

    const script = await scriptService.getScript(segment.dj_script_id);
    if (!script) throw new Error('Script not found');

    const { rows: stations } = await getPool().query('SELECT name FROM stations WHERE id = $1', [script.station_id]);
    const stationName = stations[0]?.name || 'PlayGen FM';

    const profile = await profileService.get(segment.dj_profile_id);
    if (!profile) throw new Error('Profile not found');

    const template = await scriptTemplateService.getTemplateForSegment(script.station_id, segment.segment_type);
    if (!template) throw new Error('Template not found');

    // Fetch context again
    // For simplicity in this segment-only regeneration, we'll try to get context from surrounding songs if they exist
    const currentSong = segment.before_song_id ? await this.getEntrySongInfo(segment.before_song_id) : undefined;
    const prevSong = segment.after_song_id ? await this.getEntrySongInfo(segment.after_song_id) : undefined;

    const context: PromptContext = {
      djProfile: profile,
      stationName,
      hour: 0, // Fallback
      timeOfDay: 'day',
      date: '2026-04-04',
      time: 'now',
      currentSong,
      prevSong,
    };

    const systemPrompt = promptBuilder.buildSystemPrompt(profile);
    const userPrompt = promptBuilder.buildUserPrompt(template, context);

    const adapter = getLLMAdapter();
    const response = await adapter.generateText({ prompt: userPrompt, systemPrompt });

    await scriptService.updateSegmentText(segmentId, response.text);
    return response.text;
  },

  async getEntrySongInfo(entryId: string) {
    const { rows } = await getPool().query(
      `SELECT s.title, s.artist FROM playlist_entries pe
       JOIN songs s ON pe.song_id = s.id
       WHERE pe.id = $1`,
      [entryId]
    );
    return rows[0];
  },

  async getSongInfo(songId: string) {
    const { rows } = await getPool().query(
      'SELECT title, artist FROM songs WHERE id = $1',
      [songId]
    );
    return rows[0];
  },

  getTimeOfDay(hour: number): string {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }
};
