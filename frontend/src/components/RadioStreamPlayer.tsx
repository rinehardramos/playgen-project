'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface RadioStreamPlayerProps {
  /** HLS master manifest URL (m3u8). If a master variant manifest, HLS.js will ABR. */
  src: string;
  /** Label shown in the player header */
  title?: string;
  autoPlay?: boolean;
}

type QualityLevel = { index: number; bitrate: number; label: string };

const QUALITY_LABELS: Record<number, string> = {
  32000: 'Low',
  128000: 'Standard',
  192000: 'High',
  256000: 'High',
};

function bitrateLabel(bps: number): string {
  return QUALITY_LABELS[bps] ?? `${Math.round(bps / 1000)}k`;
}

export default function RadioStreamPlayer({ src, title, autoPlay = false }: RadioStreamPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef   = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying]       = useState(false);
  const [currentLevel, setCurrentLevel] = useState<QualityLevel | null>(null);
  const [levels, setLevels]             = useState<QualityLevel[]>([]);
  const [volume, setVolume]             = useState(1);
  const [error, setError]               = useState<string | null>(null);
  const [qualitySwitches, setQualitySwitches] = useState(0);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = volume;
    audioRef.current = audio;

    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        startLevel: 0,
        capLevelToPlayerSize: false,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetry: 6,
      });
      hlsRef.current = hls;
      hls.attachMedia(audio);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const parsedLevels: QualityLevel[] = data.levels.map((l, i) => ({
          index: i,
          bitrate: l.bitrate,
          label: bitrateLabel(l.bitrate),
        }));
        setLevels(parsedLevels);
        if (autoPlay) audio.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const l = hls.levels[data.level];
        if (l) {
          setCurrentLevel({ index: data.level, bitrate: l.bitrate, label: bitrateLabel(l.bitrate) });
          setQualitySwitches(prev => prev + 1);
          console.info(`[RadioStreamPlayer] Quality switched → level ${data.level} (${bitrateLabel(l.bitrate)}, ${Math.round(l.bitrate / 1000)}kbps)`);
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setError('Stream failed to load. The content may not be available.');
              break;
          }
        }
      });

      hls.loadSource(src);
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      audio.src = src;
      if (autoPlay) audio.play().catch(() => {});
    } else {
      setError('HLS playback is not supported in this browser.');
    }

    audio.onplay  = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => setIsPlaying(false);

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      audio.pause();
      audio.src = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => setError('Playback blocked. Click play again.'));
    }
  }

  function handleVolumeChange(v: number) {
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }

  if (error) {
    return (
      <div className="bg-[#1a1a2e] border border-red-800/40 rounded-xl p-4 text-center">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-[#12121f] border border-[#2a2a40] rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-violet-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <div>
            <p className="text-white text-sm font-medium">{title ?? 'Radio Stream'}</p>
            <p className="text-gray-500 text-xs">Adaptive bitrate</p>
          </div>
        </div>

        {/* Quality indicator */}
        {currentLevel && (
          <div className="flex items-center gap-1.5 bg-[#1a1a2e] border border-[#2a2a40] rounded-lg px-2 py-1">
            <span
              className={`w-2 h-2 rounded-full ${
                currentLevel.bitrate >= 200000 ? 'bg-green-400' :
                currentLevel.bitrate >= 100000 ? 'bg-yellow-400' :
                'bg-orange-400'
              }`}
            />
            <span className="text-xs font-medium text-gray-300">{currentLevel.label}</span>
            <span className="text-xs text-gray-600">{Math.round(currentLevel.bitrate / 1000)}kbps</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-violet-600 hover:bg-violet-500 text-white transition-colors flex-shrink-0"
          aria-label={isPlaying ? 'Pause stream' : 'Play stream'}
        >
          {isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        {/* Volume */}
        <div className="flex items-center gap-1.5 flex-1">
          <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            {volume === 0 ? (
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
            ) : (
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            )}
          </svg>
          <input
            type="range" min={0} max={1} step={0.05} value={volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="flex-1 accent-violet-500 cursor-pointer"
            aria-label="Volume"
          />
        </div>

        {/* Manual quality selector */}
        {levels.length > 1 && (
          <select
            value={hlsRef.current?.currentLevel ?? -1}
            onChange={(e) => {
              if (hlsRef.current) hlsRef.current.currentLevel = parseInt(e.target.value, 10);
            }}
            className="bg-[#1a1a2e] border border-[#2a2a40] text-gray-400 text-xs rounded-md px-2 py-1 cursor-pointer"
            aria-label="Stream quality"
          >
            <option value={-1}>Auto</option>
            {levels.map(l => (
              <option key={l.index} value={l.index}>{l.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Session quality switch metric */}
      {qualitySwitches > 0 && (
        <p className="text-gray-700 text-xs text-right">
          {qualitySwitches} quality switch{qualitySwitches !== 1 ? 'es' : ''} this session
        </p>
      )}
    </div>
  );
}
