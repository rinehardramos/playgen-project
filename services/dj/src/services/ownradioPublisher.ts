/**
 * Automatic OwnRadio pickup for podcast episodes.
 *
 * When an episode reaches `ready`, we POST it to OwnRadio's program webhook
 * (upsert by station slug + recordedAt). OwnRadio only accepts public HTTPS
 * cloud playback URLs, so locally-stored audio is recorded as `skipped`
 * rather than failed — publish becomes possible once storage is S3/R2-backed
 * (S3_PUBLIC_URL_BASE), where audio_url is already a CDN URL.
 */
import { getPool } from '../db.js';
import type { PodcastEpisode } from './podcastService.js';

const OWNRADIO_WEBHOOK_URL = process.env.OWNRADIO_WEBHOOK_URL ?? '';
const PLAYGEN_WEBHOOK_SECRET = process.env.PLAYGEN_WEBHOOK_SECRET ?? '';

export interface OwnRadioPublishResult {
  status: 'published' | 'skipped' | 'failed';
  detail: string | null;
}

/** OwnRadio rejects local/private playback URLs — mirror its gate here. */
export function isPubliclyPlayable(audioUrl: string | null): boolean {
  if (!audioUrl) return false;
  if (!audioUrl.startsWith('https://')) return false;
  try {
    const host = new URL(audioUrl).hostname;
    return !(
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host)
    );
  } catch {
    return false;
  }
}

async function recordResult(episodeId: string, result: OwnRadioPublishResult): Promise<void> {
  await getPool().query(
    `UPDATE dj_podcast_episodes
     SET ownradio_status = $2,
         ownradio_error = $3,
         ownradio_published_at = COALESCE($4, ownradio_published_at),
         updated_at = NOW()
     WHERE id = $1`,
    [
      episodeId,
      result.status,
      result.status === 'published' ? null : result.detail,
      result.status === 'published' ? new Date() : null,
    ],
  );
}

/**
 * Retract a previously published episode from OwnRadio (called on episode
 * delete). Best-effort: never throws, a 404 means it was already gone.
 */
export async function retractEpisodeFromOwnRadio(episode: PodcastEpisode): Promise<void> {
  if (!OWNRADIO_WEBHOOK_URL || episode.ownradio_status !== 'published') return;
  try {
    const { rows } = await getPool().query<{ slug: string | null }>(
      'SELECT slug FROM stations WHERE id = $1',
      [episode.station_id],
    );
    const slug = rows[0]?.slug;
    if (!slug) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (PLAYGEN_WEBHOOK_SECRET) headers['X-PlayGen-Secret'] = PLAYGEN_WEBHOOK_SECRET;
    await fetch(`${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/program`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ recordedAt: new Date(episode.created_at).toISOString() }),
    });
  } catch {
    // best-effort retraction
  }
}

/**
 * Push a ready episode to OwnRadio. Never throws; the outcome is recorded on
 * the episode row (ownradio_status / ownradio_error / ownradio_published_at).
 */
export async function publishEpisodeToOwnRadio(episode: PodcastEpisode): Promise<OwnRadioPublishResult> {
  let result: OwnRadioPublishResult;

  try {
    if (episode.status !== 'ready' || !episode.audio_url) {
      result = { status: 'skipped', detail: 'episode has no rendered audio' };
    } else if (!OWNRADIO_WEBHOOK_URL) {
      result = { status: 'skipped', detail: 'OWNRADIO_WEBHOOK_URL not configured' };
    } else if (!isPubliclyPlayable(episode.audio_url)) {
      result = {
        status: 'skipped',
        detail: 'audio is on local storage — OwnRadio requires a public HTTPS cloud URL (configure S3/R2 storage)',
      };
    } else {
      const { rows } = await getPool().query<{ slug: string | null }>(
        'SELECT slug FROM stations WHERE id = $1',
        [episode.station_id],
      );
      const slug = rows[0]?.slug;
      if (!slug) {
        result = { status: 'failed', detail: 'station has no slug' };
      } else {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (PLAYGEN_WEBHOOK_SECRET) headers['X-PlayGen-Secret'] = PLAYGEN_WEBHOOK_SECRET;
        const res = await fetch(`${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/program`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: episode.title,
            description: episode.topic ?? `Podcast episode with ${episode.hosts.map(h => h.name).join(' & ')}`,
            recordedAt: new Date(episode.created_at).toISOString(),
            durationSecs: Math.max(1, Math.round(episode.audio_duration_sec ?? 0)),
            playbackUrl: episode.audio_url.split('?')[0],
          }),
        });
        if (res.ok) {
          result = { status: 'published', detail: null };
        } else {
          const body = await res.text().catch(() => '');
          result = { status: 'failed', detail: `OwnRadio responded ${res.status}: ${body.slice(0, 300)}` };
        }
      }
    }
  } catch (err) {
    result = { status: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }

  await recordResult(episode.id, result).catch((err) =>
    console.error('[ownradioPublisher] failed to record publish result', err),
  );
  return result;
}
