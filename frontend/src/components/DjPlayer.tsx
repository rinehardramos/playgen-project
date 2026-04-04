'use client';

import { useDjPlayer } from '@/lib/DjPlayerContext';

const SEGMENT_TYPE_LABELS: Record<string, string> = {
  show_intro: 'Show Intro',
  song_intro: 'Song Intro',
  song_transition: 'Transition',
  show_outro: 'Show Outro',
  station_id: 'Station ID',
  time_check: 'Time Check',
  weather_tease: 'Weather',
  ad_break: 'Ad Break',
};

export default function DjPlayer() {
  const { currentSegment, isPlaying, progress, volume, queue, pause, resume, skipNext, stop, setVolume } = useDjPlayer();

  if (!currentSegment) return null;

  const segmentLabel = SEGMENT_TYPE_LABELS[currentSegment.segmentType] ?? currentSegment.segmentType.replace(/_/g, ' ');
  const progressPct = Math.round(progress * 100);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700 shadow-2xl">
      {/* Progress bar */}
      <div className="h-0.5 bg-gray-700 w-full">
        <div
          className="h-full bg-violet-500 transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex items-center gap-4 px-4 py-3 md:px-6">
        {/* DJ icon */}
        <div className="w-9 h-9 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
          </svg>
        </div>

        {/* Segment info */}
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{currentSegment.djName}</p>
          <p className="text-gray-400 text-xs truncate">
            <span className="text-violet-400">{segmentLabel}</span>
            <span className="mx-1 text-gray-600">·</span>
            <span>Segment {currentSegment.position + 1}</span>
            {queue.length > 0 && (
              <span className="ml-1 text-gray-600">· {queue.length} queued</span>
            )}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Play / Pause */}
          <button
            onClick={isPlaying ? pause : resume}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          {/* Skip next — only shown when queue has items */}
          {queue.length > 0 && (
            <button
              onClick={skipNext}
              className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              aria-label="Skip to next segment"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/>
              </svg>
            </button>
          )}

          {/* Volume */}
          <div className="hidden sm:flex items-center gap-1.5 ml-1">
            <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
              {volume === 0 ? (
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              ) : volume < 0.5 ? (
                <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
              ) : (
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              )}
            </svg>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-16 accent-violet-500 cursor-pointer"
              aria-label="Volume"
            />
          </div>

          {/* Stop / close */}
          <button
            onClick={stop}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors"
            aria-label="Stop playback"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
