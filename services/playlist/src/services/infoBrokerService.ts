const INFO_BROKER_URL = process.env.INFO_BROKER_URL ?? '';
const INFO_BROKER_API_KEY = process.env.INFO_BROKER_API_KEY ?? '';
const PLAYGEN_INTERNAL_URL = process.env.PLAYGEN_INTERNAL_URL ?? 'https://api.playgen.site';

export interface SongToSource {
  song_id: string;
  title: string;
  artist: string;
}

/**
 * Ask info-broker to source audio for songs missing audio_url.
 * Fire-and-forget — never throws.
 */
export async function requestAudioSourcing(
  stationId: string,
  songs: SongToSource[],
): Promise<void> {
  if (!INFO_BROKER_URL || !INFO_BROKER_API_KEY || songs.length === 0) return;

  const callbackUrl = `${PLAYGEN_INTERNAL_URL}/internal/songs/audio-sourced`;

  await fetch(`${INFO_BROKER_URL}/v1/playlists/source-audio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': INFO_BROKER_API_KEY,
    },
    body: JSON.stringify({
      station_id: stationId,
      songs,
      callback_url: callbackUrl,
    }),
  }).catch((err) => console.error('[infoBrokerService] requestAudioSourcing failed', err));
}
