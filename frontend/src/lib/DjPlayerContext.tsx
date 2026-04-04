'use client';

import { createContext, useContext, useState, useRef, useCallback } from 'react';

export interface DjPlayerSegment {
  id: string;
  segmentType: string;
  position: number;
  djName: string;
  audioUrl: string;
  durationSec: number | null;
}

interface DjPlayerState {
  currentSegment: DjPlayerSegment | null;
  isPlaying: boolean;
  progress: number; // 0–1
  queue: DjPlayerSegment[];
  playSegment: (seg: DjPlayerSegment) => void;
  playQueue: (segments: DjPlayerSegment[]) => void;
  pause: () => void;
  resume: () => void;
  skipNext: () => void;
  stop: () => void;
}

const DjPlayerContext = createContext<DjPlayerState | null>(null);

export function DjPlayerProvider({ children }: { children: React.ReactNode }) {
  const [currentSegment, setCurrentSegment] = useState<DjPlayerSegment | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [queue, setQueue] = useState<DjPlayerSegment[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<DjPlayerSegment[]>([]);

  const stopCurrent = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.ontimeupdate = null;
      audioRef.current = null;
    }
    setProgress(0);
    setIsPlaying(false);
  }, []);

  const playNext = useCallback(() => {
    const remaining = queueRef.current;
    if (remaining.length === 0) {
      setCurrentSegment(null);
      setIsPlaying(false);
      setProgress(0);
      setQueue([]);
      return;
    }
    const [next, ...rest] = remaining;
    queueRef.current = rest;
    setQueue([...rest]);

    const audio = new Audio(next.audioUrl);
    audioRef.current = audio;
    setCurrentSegment(next);
    setIsPlaying(true);
    setProgress(0);

    audio.ontimeupdate = () => {
      if (audio.duration > 0) {
        setProgress(audio.currentTime / audio.duration);
      }
    };
    audio.onended = () => playNext();
    audio.onerror = () => playNext();
    audio.play().catch(() => playNext());
  }, []);

  const playSegment = useCallback((seg: DjPlayerSegment) => {
    stopCurrent();
    queueRef.current = [];
    setQueue([]);

    const audio = new Audio(seg.audioUrl);
    audioRef.current = audio;
    setCurrentSegment(seg);
    setIsPlaying(true);
    setProgress(0);

    audio.ontimeupdate = () => {
      if (audio.duration > 0) {
        setProgress(audio.currentTime / audio.duration);
      }
    };
    audio.onended = () => {
      setIsPlaying(false);
      setProgress(1);
    };
    audio.onerror = () => {
      setIsPlaying(false);
    };
    audio.play().catch(() => setIsPlaying(false));
  }, [stopCurrent]);

  const playQueue = useCallback((segments: DjPlayerSegment[]) => {
    stopCurrent();
    if (segments.length === 0) return;
    const [first, ...rest] = segments;
    queueRef.current = rest;
    setQueue([...rest]);

    const audio = new Audio(first.audioUrl);
    audioRef.current = audio;
    setCurrentSegment(first);
    setIsPlaying(true);
    setProgress(0);

    audio.ontimeupdate = () => {
      if (audio.duration > 0) {
        setProgress(audio.currentTime / audio.duration);
      }
    };
    audio.onended = () => playNext();
    audio.onerror = () => playNext();
    audio.play().catch(() => playNext());
  }, [stopCurrent, playNext]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => null);
      setIsPlaying(true);
    }
  }, []);

  const skipNext = useCallback(() => {
    stopCurrent();
    playNext();
  }, [stopCurrent, playNext]);

  const stop = useCallback(() => {
    stopCurrent();
    queueRef.current = [];
    setQueue([]);
    setCurrentSegment(null);
  }, [stopCurrent]);

  return (
    <DjPlayerContext.Provider value={{
      currentSegment,
      isPlaying,
      progress,
      queue,
      playSegment,
      playQueue,
      pause,
      resume,
      skipNext,
      stop,
    }}>
      {children}
    </DjPlayerContext.Provider>
  );
}

export function useDjPlayer(): DjPlayerState {
  const ctx = useContext(DjPlayerContext);
  if (!ctx) throw new Error('useDjPlayer must be used inside DjPlayerProvider');
  return ctx;
}
