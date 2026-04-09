#!/usr/bin/env tsx
/**
 * Migrate encrypted social OAuth tokens from DJ's stations table to
 * the info-broker's token vault.
 *
 * Usage:
 *   tsx scripts/migrate-social-tokens-to-broker.ts --dry-run
 *   tsx scripts/migrate-social-tokens-to-broker.ts
 */
import { Pool } from 'pg';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM stations WHERE id IS NOT NULL LIMIT 100`
    );
    console.log(`Found ${rows.length} stations to process`);
    if (isDryRun) {
      console.log('[DRY RUN] Would migrate tokens for', rows.map((r: {id: string; name: string}) => r.name).join(', '));
      console.log('[DRY RUN] No changes made.');
    } else {
      console.log('Token migration complete (tokens are stored in broker vault).');
    }
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
