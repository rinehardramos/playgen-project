import { getPool } from '../db.js';
import type { DjProfile } from '@playgen/types';

export async function listProfiles(company_id: string): Promise<DjProfile[]> {
  const { rows } = await getPool().query<DjProfile>(
    `SELECT * FROM dj_profiles WHERE company_id = $1 ORDER BY is_default DESC, name`,
    [company_id],
  );
  return rows;
}

export async function getProfile(id: string, company_id: string): Promise<DjProfile | null> {
  const { rows } = await getPool().query<DjProfile>(
    `SELECT * FROM dj_profiles WHERE id = $1 AND company_id = $2`,
    [id, company_id],
  );
  return rows[0] ?? null;
}

export async function getDefaultProfile(company_id: string): Promise<DjProfile | null> {
  const { rows } = await getPool().query<DjProfile>(
    `SELECT * FROM dj_profiles WHERE company_id = $1 AND is_default = TRUE AND is_active = TRUE LIMIT 1`,
    [company_id],
  );
  return rows[0] ?? null;
}

export async function createProfile(
  company_id: string,
  data: Omit<DjProfile, 'id' | 'company_id' | 'created_at' | 'updated_at'>,
): Promise<DjProfile> {
  const pool = getPool();

  // If marking as default, unset existing default first
  if (data.is_default) {
    await pool.query(
      `UPDATE dj_profiles SET is_default = FALSE WHERE company_id = $1`,
      [company_id],
    );
  }

  const { rows } = await pool.query<DjProfile>(
    `INSERT INTO dj_profiles (company_id, name, personality, voice_style,
       llm_model, llm_temperature, tts_provider, tts_voice_id, is_default, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      company_id,
      data.name,
      data.personality,
      data.voice_style,
      data.llm_model,
      data.llm_temperature,
      data.tts_provider,
      data.tts_voice_id,
      data.is_default,
      data.is_active,
    ],
  );
  return rows[0];
}

export async function updateProfile(
  id: string,
  company_id: string,
  data: Partial<Omit<DjProfile, 'id' | 'company_id' | 'created_at' | 'updated_at'>>,
): Promise<DjProfile | null> {
  const pool = getPool();

  if (data.is_default) {
    await pool.query(
      `UPDATE dj_profiles SET is_default = FALSE WHERE company_id = $1 AND id != $2`,
      [company_id, id],
    );
  }

  const { rows } = await pool.query<DjProfile>(
    `UPDATE dj_profiles
     SET name = COALESCE($3, name),
         personality = COALESCE($4, personality),
         voice_style = COALESCE($5, voice_style),
         llm_model = COALESCE($6, llm_model),
         llm_temperature = COALESCE($7, llm_temperature),
         tts_provider = COALESCE($8, tts_provider),
         tts_voice_id = COALESCE($9, tts_voice_id),
         is_default = COALESCE($10, is_default),
         is_active = COALESCE($11, is_active),
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING *`,
    [
      id, company_id,
      data.name ?? null,
      data.personality ?? null,
      data.voice_style ?? null,
      data.llm_model ?? null,
      data.llm_temperature ?? null,
      data.tts_provider ?? null,
      data.tts_voice_id ?? null,
      data.is_default ?? null,
      data.is_active ?? null,
    ],
  );
  return rows[0] ?? null;
}

export async function deleteProfile(id: string, company_id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM dj_profiles WHERE id = $1 AND company_id = $2 AND is_default = FALSE`,
    [id, company_id],
  );
  return (rowCount ?? 0) > 0;
}
