/**
 * Notifies OwnRadio of stream control events (url change, stop, resume, dj switch).
 * Calls the OwnRadio webhook API, which relays events to connected clients via socket.io.
 */

const OWNRADIO_WEBHOOK_URL = process.env.OWNRADIO_WEBHOOK_URL ?? '';
const PLAYGEN_WEBHOOK_SECRET = process.env.PLAYGEN_WEBHOOK_SECRET ?? '';

function webhookHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (PLAYGEN_WEBHOOK_SECRET) {
    headers['X-PlayGen-Secret'] = PLAYGEN_WEBHOOK_SECRET;
  }
  return headers;
}

export async function notifyStreamUrlChange(slug: string, streamUrl: string): Promise<void> {
  if (!OWNRADIO_WEBHOOK_URL) return;
  await fetch(`${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/stream-control`, {
    method: 'POST',
    headers: webhookHeaders(),
    body: JSON.stringify({ action: 'url_change', streamUrl }),
  });
}

export async function notifyStreamStop(slug: string): Promise<void> {
  if (!OWNRADIO_WEBHOOK_URL) return;
  await fetch(`${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/stream-control`, {
    method: 'POST',
    headers: webhookHeaders(),
    body: JSON.stringify({ action: 'stop' }),
  });
}

export async function notifyStreamResume(slug: string): Promise<void> {
  if (!OWNRADIO_WEBHOOK_URL) return;
  await fetch(`${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/stream-control`, {
    method: 'POST',
    headers: webhookHeaders(),
    body: JSON.stringify({ action: 'resume' }),
  });
}

export async function notifyDjSwitch(
  slug: string,
  djId: string,
  name: string,
  voiceStyle?: string,
): Promise<void> {
  if (!OWNRADIO_WEBHOOK_URL) return;
  await fetch(`${OWNRADIO_WEBHOOK_URL}/webhooks/stations/${slug}/dj-switch`, {
    method: 'POST',
    headers: webhookHeaders(),
    body: JSON.stringify({ djId, name, voiceStyle }),
  });
}
