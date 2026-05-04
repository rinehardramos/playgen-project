/**
 * Unit tests for specService (#495 — Station Spec).
 *
 * Tests: parseSpec, serializeSpecToYaml, exportSpec (mocked DB),
 * applySpec (mocked DB), and buildSpecRulesSection from promptBuilder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock ───────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

vi.mock('../../src/services/djSetupService', () => ({
  seedDefaultDjProfileForStation: vi.fn().mockResolvedValue(undefined),
}));

import { parseSpec, serializeSpecToYaml } from '../../src/services/specService';
import type { StationSpec } from '@playgen/types';

// ─── parseSpec ────────────────────────────────────────────────────────────────

describe('parseSpec', () => {
  it('parses a minimal YAML spec', () => {
    const yaml = `
name: Test FM
callsign: TSTF
timezone: Asia/Manila
`;
    const spec = parseSpec(yaml);
    expect(spec.name).toBe('Test FM');
    expect(spec.callsign).toBe('TSTF');
    expect(spec.timezone).toBe('Asia/Manila');
  });

  it('parses a JSON string (YAML superset)', () => {
    const json = JSON.stringify({ name: 'JSON FM', broadcast: { start_hour: 6, end_hour: 2 } });
    const spec = parseSpec(json);
    expect(spec.name).toBe('JSON FM');
    expect(spec.broadcast?.start_hour).toBe(6);
  });

  it('parses a full spec with DJs, script_rules, and library', () => {
    const yaml = `
version: "1"
name: OwnRadio Manila
callsign: OWFM
locale: fil-PH
djs:
  - name: Bianca
    role: primary
    energy: 9
    humor: 7
    catchphrases:
      - "Tara na!"
      - "Good vibes lang!"
    personality: "Bubbly Pinay DJ"
script_rules:
  language: Taglish
  tone: Energetic
  avoid:
    - Reading ad copy verbatim
  always:
    - Mention station callsign in station_id segments
library:
  songs_per_hour: 3
  rules:
    - At least 1 OPM song per hour
`;
    const spec = parseSpec(yaml);
    expect(spec.callsign).toBe('OWFM');
    expect(spec.djs?.[0]?.name).toBe('Bianca');
    expect(spec.djs?.[0]?.catchphrases).toContain('Tara na!');
    expect(spec.script_rules?.language).toBe('Taglish');
    expect(spec.script_rules?.avoid).toContain('Reading ad copy verbatim');
    expect(spec.library?.rules).toContain('At least 1 OPM song per hour');
  });

  it('throws on a non-object YAML document', () => {
    expect(() => parseSpec('- item1\n- item2')).toThrow('Spec must be a YAML/JSON object');
  });

  it('throws on invalid YAML syntax', () => {
    expect(() => parseSpec('name: [unclosed')).toThrow();
  });
});

// ─── serializeSpecToYaml ──────────────────────────────────────────────────────

describe('serializeSpecToYaml', () => {
  it('serializes a spec to YAML string', () => {
    const spec: StationSpec = {
      version: '1',
      name: 'Test FM',
      callsign: 'TSTF',
      djs: [{ name: 'Alex', role: 'primary' }],
    };
    const yaml = serializeSpecToYaml(spec);
    expect(yaml).toContain('name: Test FM');
    expect(yaml).toContain('callsign: TSTF');
    expect(yaml).toContain('- name: Alex');
  });

  it('round-trips: parse → serialize → parse produces equivalent object', () => {
    const original: StationSpec = {
      version: '1',
      name: 'Round Trip FM',
      script_rules: {
        language: 'English',
        avoid: ['cursing', 'politics'],
        always: ['Stay upbeat'],
      },
    };
    const yaml = serializeSpecToYaml(original);
    const reparsed = parseSpec(yaml);
    expect(reparsed.name).toBe('Round Trip FM');
    expect(reparsed.script_rules?.avoid).toEqual(['cursing', 'politics']);
  });
});

// ─── buildSpecRulesSection (from promptBuilder) ───────────────────────────────
// Tested here to keep DJ service tests clean; the function is pure.

describe('buildSpecRulesSection', () => {
  // Lazily import from the DJ service's promptBuilder
  // (It's a separate package; we test the logic via the exported function directly)
  it('returns null when no spec data', async () => {
    const { buildSpecRulesSection } = await import('../../../dj/src/lib/promptBuilder.js');
    expect(buildSpecRulesSection(null, null)).toBeNull();
    expect(buildSpecRulesSection(undefined, undefined)).toBeNull();
  });

  it('builds a rules section from script_rules', async () => {
    const { buildSpecRulesSection } = await import('../../../dj/src/lib/promptBuilder.js');
    const result = buildSpecRulesSection(
      { language: 'Taglish', tone: 'Energetic', avoid: ['politics'], always: ['Mention OWFM'] },
      null,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('Station-specific guidelines');
    expect(result).toContain('Taglish');
    expect(result).toContain('Energetic');
    expect(result).toContain('politics');
    expect(result).toContain('OWFM');
  });

  it('includes library rules when present', async () => {
    const { buildSpecRulesSection } = await import('../../../dj/src/lib/promptBuilder.js');
    const result = buildSpecRulesSection(null, { rules: ['At least 1 OPM per hour'] });
    expect(result).toContain('OPM per hour');
  });

  it('returns null when all rules are empty arrays', async () => {
    const { buildSpecRulesSection } = await import('../../../dj/src/lib/promptBuilder.js');
    const result = buildSpecRulesSection(
      { avoid: [], always: [] },
      { rules: [] },
    );
    expect(result).toBeNull();
  });
});

// ─── buildSystemPrompt spec injection ─────────────────────────────────────────

describe('buildSystemPrompt with specRules', () => {
  it('appends specRules block to single-DJ prompt', async () => {
    const { buildSystemPrompt } = await import('../../../dj/src/lib/promptBuilder.js');
    const profile = {
      id: 'p1',
      company_id: 'c1',
      name: 'Alex',
      personality: 'Cool DJ',
      voice_style: 'energetic',
      llm_model: 'gpt-4o',
      llm_temperature: 0.8,
      tts_provider: 'openai',
      tts_voice_id: 'alloy',
      persona_config: null,
      is_default: true,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const rules = 'Station-specific guidelines:\nAlways mention OWFM';
    const prompt = buildSystemPrompt(profile as never, 'en-US', 'openai', rules);
    expect(prompt).toContain('Station-specific guidelines');
    expect(prompt).toContain('OWFM');
  });

  it('omits spec section when specRules is null', async () => {
    const { buildSystemPrompt } = await import('../../../dj/src/lib/promptBuilder.js');
    const profile = {
      id: 'p1',
      company_id: 'c1',
      name: 'Alex',
      personality: 'Cool DJ',
      voice_style: 'energetic',
      llm_model: 'gpt-4o',
      llm_temperature: 0.8,
      tts_provider: 'openai',
      tts_voice_id: 'alloy',
      persona_config: null,
      is_default: true,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const prompt = buildSystemPrompt(profile as never, null, null, null);
    expect(prompt).not.toContain('Station-specific guidelines');
  });
});
