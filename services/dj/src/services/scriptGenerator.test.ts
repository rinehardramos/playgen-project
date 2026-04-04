import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scriptGenerator } from './scriptGenerator';
import { scriptService } from './scriptService';
import { getPool } from '../db';
import { daypartService } from './daypartService';
import { scriptTemplateService } from './scriptTemplateService';
import { getLLMAdapter } from '../adapters/llm/registry';
import { promptBuilder } from '../utils/promptBuilder';

vi.mock('./scriptService');
vi.mock('../db');
vi.mock('./daypartService');
vi.mock('./scriptTemplateService');
vi.mock('../adapters/llm/registry');
vi.mock('../utils/promptBuilder');

describe('scriptGenerator', () => {
  const mockPool = {
    query: vi.fn(),
  };

  const mockAdapter = {
    generateText: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getPool as any).mockReturnValue(mockPool);
    (getLLMAdapter as any).mockReturnValue(mockAdapter);

    // Default mock implementation
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM playlist_entries')) {
        return { rows: [{ id: 'e1', hour: 10, song_id: 'song-1', position: 1 }] };
      }
      if (sql.includes('FROM stations')) {
        return { rows: [{ name: 'Test Radio' }] };
      }
      if (sql.includes('FROM songs')) {
        return { rows: [{ title: 'Song 1', artist: 'Artist 1' }] };
      }
      return { rows: [] };
    });
  });

  it('should generate scripts for a playlist', async () => {
    const scriptId = 'script-1';
    const mockScript = { id: scriptId, station_id: 's1', playlist_id: 'p1' };
    
    (scriptService.getScript as any).mockResolvedValue(mockScript);
    (daypartService.resolveProfileForHour as any).mockResolvedValue({ id: 'dj-1', name: 'Alex' });
    (scriptTemplateService.getTemplateForSegment as any).mockResolvedValue('Hi {{dj_name}}');
    (promptBuilder.buildSystemPrompt as any).mockReturnValue('System');
    (promptBuilder.buildUserPrompt as any).mockReturnValue('User');
    mockAdapter.generateText.mockResolvedValue({ text: 'Generated Text', model: 'gpt-4' });

    await scriptGenerator.generateForPlaylist(scriptId);

    expect(scriptService.updateScriptStatus).toHaveBeenCalledWith(scriptId, 'generating_scripts');
    expect(scriptService.createSegment).toHaveBeenCalledWith(expect.objectContaining({
      script_text: 'Generated Text',
      segment_type: 'show_open'
    }));
    expect(scriptService.updateScriptStatus).toHaveBeenCalledWith(scriptId, 'pending_review');
  });
});
