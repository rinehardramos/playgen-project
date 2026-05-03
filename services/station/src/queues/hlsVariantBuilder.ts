/**
 * Builds HLS Master Playlist with variant streams (RFC 8216 §4.3.4.2).
 * Pure function — no I/O, no side effects.
 */

export interface VariantStream {
  /** Bits per second — used for #EXT-X-STREAM-INF BANDWIDTH attribute */
  bandwidth: number;
  /** Codec string — e.g. 'mp4a.40.2' for AAC-LC */
  codecs: string;
  /** URL to the variant's sub-playlist (.m3u8) */
  uri: string;
  /** Optional human-readable label for the quality level (e.g. 'Low', 'High') */
  label?: string;
}

/**
 * Build the text content of an HLS Master Playlist pointing to variant sub-playlists.
 * Variants are sorted ascending by bandwidth so HLS.js starts at the lowest quality.
 * Returns empty string if variants array is empty.
 */
export function buildVariantMasterM3u8(variants: VariantStream[]): string {
  if (variants.length === 0) return '';

  const sorted = [...variants].sort((a, b) => a.bandwidth - b.bandwidth);

  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
  ];

  for (const v of sorted) {
    const nameAttr = v.label ? `,NAME="${v.label}"` : '';
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},CODECS="${v.codecs}"${nameAttr}`);
    lines.push(v.uri);
  }

  return lines.join('\n') + '\n';
}
