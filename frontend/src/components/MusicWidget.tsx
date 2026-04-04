'use client';

import { useState } from 'react';

interface MusicWidgetProps {
  /** Spotify track ID (the part after /track/ in the Spotify URL) */
  spotifyId?: string | null;
  /** Apple Music track/album ID */
  appleMusicId?: string | null;
}

/**
 * Embeds a Spotify or Apple Music preview widget for a song.
 * Only renders when at least one platform ID is provided.
 */
export default function MusicWidget({ spotifyId, appleMusicId }: MusicWidgetProps) {
  const [platform, setPlatform] = useState<'spotify' | 'apple'>(
    spotifyId ? 'spotify' : 'apple',
  );

  if (!spotifyId && !appleMusicId) return null;

  const hasBoth = Boolean(spotifyId && appleMusicId);

  return (
    <div className="mt-2 rounded-xl overflow-hidden bg-black/20 border border-[#2a2a40]">
      {/* Platform toggle — only shown when both IDs are available */}
      {hasBoth && (
        <div className="flex border-b border-[#2a2a40]">
          <button
            onClick={(e) => { e.stopPropagation(); setPlatform('spotify'); }}
            className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 ${
              platform === 'spotify'
                ? 'text-green-400 bg-green-900/10'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.285c-.213.349-.667.454-1.016.242-2.785-1.703-6.29-2.088-10.418-1.144-.397.091-.795-.158-.886-.555-.091-.397.158-.795.555-.886 4.516-1.032 8.386-.588 11.521 1.327.349.213.454.667.244 1.016zm1.471-3.27c-.269.437-.843.573-1.279.304-3.188-1.96-8.048-2.529-11.82-1.383-.489.148-1.006-.13-1.154-.618-.148-.489.13-1.006.618-1.154 4.309-1.308 9.672-.674 13.331 1.572.437.269.573.843.304 1.279zm.127-3.404c-3.824-2.27-10.131-2.48-13.784-1.373-.587.178-1.207-.154-1.385-.741-.178-.587.154-1.207.741-1.385 4.195-1.272 11.169-1.027 15.574 1.587.528.314.704 1 .39 1.527-.313.528-1 .704-1.536.385z"/>
            </svg>
            Spotify
          </button>
          <span className="w-px bg-[#2a2a40]" />
          <button
            onClick={(e) => { e.stopPropagation(); setPlatform('apple'); }}
            className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center justify-center gap-1 ${
              platform === 'apple'
                ? 'text-red-400 bg-red-900/10'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            Apple Music
          </button>
        </div>
      )}

      {/* Spotify embed */}
      {(platform === 'spotify' || !hasBoth) && spotifyId && (
        <iframe
          src={`https://open.spotify.com/embed/track/${spotifyId}?utm_source=generator&theme=0`}
          width="100%"
          height="80"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          title="Spotify preview"
          className="block"
          style={{ border: 0 }}
        />
      )}

      {/* Apple Music embed */}
      {(platform === 'apple' || !hasBoth) && appleMusicId && (
        <iframe
          allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write"
          height="150"
          style={{ width: '100%', maxWidth: '660px', overflow: 'hidden', border: 0 }}
          sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
          src={`https://embed.music.apple.com/us/album/${appleMusicId}?app=music`}
          title="Apple Music preview"
          className="block"
          loading="lazy"
        />
      )}
    </div>
  );
}
