/**
 * specService — export, apply, and bootstrap stations from a StationSpec.
 *
 * A StationSpec is a declarative blueprint for a station: identity, DJ personas,
 * programs, TTS config, and script rules. Partial specs are valid — only the
 * fields present are applied; everything else is left unchanged.
 */
import yaml from 'js-yaml';
import { getPool } from '../db';
import type { StationSpec, SpecDj, SpecProgram, Station } from '@playgen/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a raw string as YAML or JSON into a StationSpec. Throws on parse error. */
export function parseSpec(raw: string): StationSpec {
  // js-yaml parses both YAML and JSON (JSON is valid YAML)
  const parsed = yaml.load(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Spec must be a YAML/JSON object');
  }
  return parsed as StationSpec;
}

/** Serialise a StationSpec to YAML string. */
export function serializeSpecToYaml(spec: StationSpec): string {
  return yaml.dump(spec, { lineWidth: 120, noRefs: true });
}

// ─── Export ────────────────────────────────────────────────────────────────────

/**
 * Build a StationSpec from the current station database state.
 * Reads: stations row + dj_profiles + programs + station_settings (non-secret).
 */
export async function exportSpec(stationId: string): Promise<StationSpec | null> {
  const pool = getPool();

  const { rows: stRows } = await pool.query<Station>(
    `SELECT * FROM stations WHERE id = $1`,
    [stationId],
  );
  const station = stRows[0];
  if (!station) return null;

  // Load non-secret station settings (TTS/LLM provider + voice)
  const { rows: settingRows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM station_settings WHERE station_id = $1 AND is_secret = false`,
    [stationId],
  );
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));

  // Load DJ profiles
  const { rows: djRows } = await pool.query<{
    name: string;
    personality: string | null;
    voice_style: string | null;
    tts_provider: string | null;
    tts_voice_id: string | null;
    is_default: boolean;
    persona_config: Record<string, unknown> | null;
  }>(
    `SELECT name, personality, voice_style, tts_provider, tts_voice_id, is_default, persona_config
     FROM dj_profiles WHERE company_id = (SELECT company_id FROM stations WHERE id = $1) AND is_active = true
     ORDER BY is_default DESC, name`,
    [stationId],
  );

  // Load programs
  const { rows: progRows } = await pool.query<{
    name: string;
    start_hour: number;
    end_hour: number;
    active_days: string[];
    themes: unknown;
  }>(
    `SELECT name, start_hour, end_hour, active_days, themes FROM programs WHERE station_id = $1 AND is_active = true ORDER BY start_hour`,
    [stationId],
  );

  const djs: SpecDj[] = djRows.map((dj, idx) => {
    const pc = dj.persona_config ?? {};
    const entry: SpecDj = {
      name: dj.name,
      role: idx === 0 ? 'primary' : 'co-host',
    };
    if (dj.tts_provider || dj.tts_voice_id) {
      entry.voice = {
        provider: dj.tts_provider ?? 'openai',
        voice_id: dj.tts_voice_id ?? 'alloy',
      };
    }
    if (dj.personality) entry.personality = dj.personality;
    if (typeof pc.energy_level === 'number') entry.energy = pc.energy_level;
    if (typeof pc.humor_level === 'number') entry.humor = pc.humor_level;
    if (typeof pc.formality === 'string') entry.formality = pc.formality as SpecDj['formality'];
    if (Array.isArray(pc.catchphrases) && pc.catchphrases.length) entry.catchphrases = pc.catchphrases as string[];
    if (typeof pc.signature_greeting === 'string') entry.greeting = pc.signature_greeting;
    if (typeof pc.signature_signoff === 'string') entry.signoff = pc.signature_signoff;
    if (typeof pc.backstory === 'string') entry.backstory = pc.backstory;
    return entry;
  });

  const spec: StationSpec = {
    version: '1',
    name: station.name,
    timezone: station.timezone,
    broadcast: {
      start_hour: station.broadcast_start_hour,
      end_hour: station.broadcast_end_hour,
      active_days: station.active_days,
    },
  };

  if (station.callsign) spec.callsign = station.callsign;
  if (station.tagline) spec.tagline = station.tagline;
  if (station.frequency) spec.frequency = station.frequency;
  if (station.broadcast_type) spec.broadcast_type = station.broadcast_type;
  if (station.city) spec.city = station.city;
  if (station.locale_code) spec.locale = station.locale_code;

  if (settings['tts_provider'] || settings['tts_voice_id']) {
    spec.tts = {
      provider: settings['tts_provider'],
      default_voice: settings['tts_voice_id'],
    };
  }

  if (djs.length) spec.djs = djs;

  if (progRows.length) {
    spec.programs = progRows.map((p) => ({
      name: p.name,
      start_hour: p.start_hour,
      end_hour: p.end_hour,
      active_days: p.active_days,
      ...(Array.isArray(p.themes) && p.themes.length ? { themes: p.themes as StationSpec['programs'] extends (infer T)[] ? T extends { themes?: infer TH } ? NonNullable<TH> : never[] : never[] } : {}),
    }));
  }

  // Include stored spec rules if any (from a previous apply)
  if (station.station_spec?.script_rules) {
    spec.script_rules = station.station_spec.script_rules;
  }
  if (station.station_spec?.library) {
    spec.library = station.station_spec.library;
  }
  if (station.station_spec?.dj_interaction) {
    spec.dj_interaction = station.station_spec.dj_interaction;
  }

  return spec;
}

// ─── Apply ─────────────────────────────────────────────────────────────────────

/**
 * Apply a StationSpec to an existing station.
 * Non-destructive — only fields present in the spec are updated.
 * Returns the updated station row.
 */
export async function applySpec(stationId: string, spec: StationSpec): Promise<Station | null> {
  const pool = getPool();

  // 1. Update core station fields
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const addField = (col: string, val: unknown) => {
    if (val !== undefined) { fields.push(`${col} = $${i++}`); values.push(val); }
  };

  addField('name', spec.name);
  addField('timezone', spec.timezone);
  addField('callsign', spec.callsign);
  addField('tagline', spec.tagline);
  addField('frequency', spec.frequency);
  addField('broadcast_type', spec.broadcast_type);
  addField('city', spec.city);
  addField('locale_code', spec.locale);
  if (spec.broadcast?.start_hour !== undefined) addField('broadcast_start_hour', spec.broadcast.start_hour);
  if (spec.broadcast?.end_hour !== undefined) addField('broadcast_end_hour', spec.broadcast.end_hour);
  if (spec.broadcast?.active_days !== undefined) addField('active_days', spec.broadcast.active_days);

  // Store the full spec as JSONB for pipeline use
  addField('station_spec', JSON.stringify(spec));

  if (fields.length) {
    fields.push('updated_at = NOW()');
    values.push(stationId);
    await pool.query(
      `UPDATE stations SET ${fields.join(', ')} WHERE id = $${i}`,
      values,
    );
  }

  // 2. Apply TTS settings (provider + default voice — non-secret)
  if (spec.tts?.provider) {
    await pool.query(
      `INSERT INTO station_settings (station_id, key, value, is_secret)
       VALUES ($1, 'tts_provider', $2, false)
       ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [stationId, spec.tts.provider],
    );
  }
  if (spec.tts?.default_voice) {
    await pool.query(
      `INSERT INTO station_settings (station_id, key, value, is_secret)
       VALUES ($1, 'tts_voice_id', $2, false)
       ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [stationId, spec.tts.default_voice],
    );
  }

  // 3. Apply DJ personas (upsert by name within company)
  if (spec.djs?.length) {
    const { rows: companyRows } = await pool.query<{ company_id: string }>(
      `SELECT company_id FROM stations WHERE id = $1`,
      [stationId],
    );
    const companyId = companyRows[0]?.company_id;
    if (companyId) {
      for (let idx = 0; idx < spec.djs.length; idx++) {
        await upsertDjFromSpec(companyId, spec.djs[idx], idx === 0);
      }
    }
  }

  // 4. Apply programs (upsert by name within station)
  if (spec.programs?.length) {
    for (const prog of spec.programs) {
      const [startHour, endHour] = resolveHours(prog);
      await pool.query(
        `INSERT INTO programs (station_id, name, start_hour, end_hour, active_days, is_active, is_default)
         VALUES ($1, $2, $3, $4, $5, true, false)
         ON CONFLICT (station_id, name) DO UPDATE
           SET start_hour = EXCLUDED.start_hour,
               end_hour = EXCLUDED.end_hour,
               active_days = EXCLUDED.active_days,
               updated_at = NOW()`,
        [stationId, prog.name, startHour, endHour, prog.active_days ?? ['MON','TUE','WED','THU','FRI','SAT','SUN']],
      );
    }
  }

  const { rows } = await pool.query<Station>(
    `SELECT * FROM stations WHERE id = $1`,
    [stationId],
  );
  return rows[0] ?? null;
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Create a brand-new station from a StationSpec.
 * Reuses the existing createStation flow then applies the spec on top.
 */
export async function bootstrapFromSpec(companyId: string, spec: StationSpec): Promise<Station> {
  const pool = getPool();

  const name = spec.name ?? 'New Station';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const { rows } = await pool.query<Station>(
    `INSERT INTO stations
       (company_id, name, slug, timezone, broadcast_start_hour, broadcast_end_hour, active_days,
        callsign, tagline, frequency, broadcast_type, city, locale_code, station_spec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     RETURNING *`,
    [
      companyId,
      name,
      slug,
      spec.timezone ?? 'Asia/Manila',
      spec.broadcast?.start_hour ?? 4,
      spec.broadcast?.end_hour ?? 3,
      spec.broadcast?.active_days ?? ['MON','TUE','WED','THU','FRI','SAT','SUN'],
      spec.callsign ?? null,
      spec.tagline ?? null,
      spec.frequency ?? null,
      spec.broadcast_type ?? null,
      spec.city ?? null,
      spec.locale ?? null,
      JSON.stringify(spec),
    ],
  );
  const station = rows[0];

  // Seed rotation rules
  await pool.query(
    `INSERT INTO rotation_rules (station_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [station.id],
  );

  // Fire-and-forget: seed default DJ + defaults, then apply spec on top
  const { seedDefaultDjProfileForStation } = await import('./djSetupService');
  seedDefaultDjProfileForStation(companyId, station.id).catch((err) => {
    console.error('[spec] Failed to seed default DJ profile:', err);
  });

  // Apply DJ personas, programs, settings from spec (after a short delay for defaults to settle)
  // We call applySpec but skip the identity fields (already set above)
  setImmediate(async () => {
    try {
      const specWithoutIdentity: StationSpec = {
        tts: spec.tts,
        djs: spec.djs,
        programs: spec.programs,
      };
      await applySpec(station.id, specWithoutIdentity);
    } catch (err) {
      console.error('[spec] Failed to apply spec on bootstrap:', err);
    }
  });

  return station;
}

// ─── Internals ─────────────────────────────────────────────────────────────────

async function upsertDjFromSpec(companyId: string, dj: SpecDj, makeDefault: boolean): Promise<void> {
  const pool = getPool();
  const personaConfig = {
    ...(dj.energy !== undefined ? { energy_level: dj.energy } : {}),
    ...(dj.humor !== undefined ? { humor_level: dj.humor } : {}),
    ...(dj.formality ? { formality: dj.formality } : {}),
    ...(dj.catchphrases?.length ? { catchphrases: dj.catchphrases } : {}),
    ...(dj.greeting ? { signature_greeting: dj.greeting } : {}),
    ...(dj.signoff ? { signature_signoff: dj.signoff } : {}),
    ...(dj.backstory ? { backstory: dj.backstory } : {}),
  };

  await pool.query(
    `INSERT INTO dj_profiles
       (company_id, name, personality, voice_style, tts_provider, tts_voice_id, persona_config, is_default, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,true)
     ON CONFLICT (company_id, name) DO UPDATE
       SET personality   = COALESCE(EXCLUDED.personality, dj_profiles.personality),
           voice_style   = COALESCE(EXCLUDED.voice_style, dj_profiles.voice_style),
           tts_provider  = COALESCE(EXCLUDED.tts_provider, dj_profiles.tts_provider),
           tts_voice_id  = COALESCE(EXCLUDED.tts_voice_id, dj_profiles.tts_voice_id),
           persona_config= COALESCE(EXCLUDED.persona_config, dj_profiles.persona_config),
           updated_at    = NOW()`,
    [
      companyId,
      dj.name,
      dj.personality ?? null,
      null,
      dj.voice?.provider ?? null,
      dj.voice?.voice_id ?? null,
      Object.keys(personaConfig).length ? JSON.stringify(personaConfig) : null,
      makeDefault,
    ],
  );
}

/** Resolve start/end hours from a SpecProgram, handling "5-12" shorthand. */
function resolveHours(prog: SpecProgram): [number, number] {
  if (typeof prog.start_hour === 'number' && typeof prog.end_hour === 'number') {
    return [prog.start_hour, prog.end_hour];
  }
  if (prog.hours) {
    const match = prog.hours.match(/^(\d+)-(\d+)$/);
    if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];
  }
  return [0, 23];
}
