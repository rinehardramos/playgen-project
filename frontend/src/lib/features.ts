/**
 * Lightweight feature-flag helper.
 *
 * Flags are keyed by a dotted name (e.g. "ui.advancedPlaylistCreation").
 * Each flag reads a corresponding env variable:
 *   "ui.advancedPlaylistCreation" → NEXT_PUBLIC_FEATURE_UI_ADVANCED_PLAYLIST_CREATION
 *
 * Any value other than "true" (case-insensitive) is treated as disabled.
 * Flags default to false (off) unless explicitly enabled.
 */

const FLAG_ENV_MAP: Record<string, string> = {
  'ui.advancedPlaylistCreation': 'NEXT_PUBLIC_FEATURE_UI_ADVANCED_PLAYLIST_CREATION',
};

export function isFeatureEnabled(flag: string): boolean {
  const envKey = FLAG_ENV_MAP[flag];
  if (!envKey) return false;
  return process.env[envKey]?.toLowerCase() === 'true';
}
