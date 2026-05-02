import { describe, it, expect } from 'vitest';
import { PIPELINE_STAGES, getDownstreamStages, type PipelineStage } from '../../src/services/pipelineTracker.js';

describe('PIPELINE_STAGES', () => {
  it('contains all 5 stages in order', () => {
    expect(PIPELINE_STAGES).toEqual(['playlist', 'dj_script', 'review', 'tts', 'publish']);
  });

  it('has no duplicate stages', () => {
    expect(new Set(PIPELINE_STAGES).size).toBe(PIPELINE_STAGES.length);
  });
});

describe('getDownstreamStages', () => {
  it('returns all stages after playlist (4 downstream)', () => {
    expect(getDownstreamStages('playlist')).toEqual(['dj_script', 'review', 'tts', 'publish']);
  });

  it('returns stages after dj_script (3 downstream)', () => {
    expect(getDownstreamStages('dj_script')).toEqual(['review', 'tts', 'publish']);
  });

  it('returns stages after review (2 downstream)', () => {
    expect(getDownstreamStages('review')).toEqual(['tts', 'publish']);
  });

  it('returns stages after tts (1 downstream)', () => {
    expect(getDownstreamStages('tts')).toEqual(['publish']);
  });

  it('returns empty array for publish (last stage — no downstream)', () => {
    expect(getDownstreamStages('publish')).toEqual([]);
  });

  it('retried stage itself is NOT included in downstream', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(getDownstreamStages(stage)).not.toContain(stage);
    }
  });

  it('all returned stages appear after the retried stage in PIPELINE_STAGES', () => {
    for (const stage of PIPELINE_STAGES) {
      const stageIdx = PIPELINE_STAGES.indexOf(stage);
      const downstream = getDownstreamStages(stage);
      for (const ds of downstream) {
        expect(PIPELINE_STAGES.indexOf(ds)).toBeGreaterThan(stageIdx);
      }
    }
  });
});

describe('pipeline stage validation', () => {
  const VALID_STAGES = new Set<string>(PIPELINE_STAGES);

  it('accepts all valid stage names', () => {
    const valid: PipelineStage[] = ['playlist', 'dj_script', 'review', 'tts', 'publish'];
    for (const s of valid) {
      expect(VALID_STAGES.has(s)).toBe(true);
    }
  });

  it('rejects invalid stage names', () => {
    const invalid = ['upload_assets', 'validate', 'ingest', '', 'PLAYLIST', 'script'];
    for (const s of invalid) {
      expect(VALID_STAGES.has(s)).toBe(false);
    }
  });
});
