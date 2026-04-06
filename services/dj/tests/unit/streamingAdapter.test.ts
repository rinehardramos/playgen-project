import { describe, it, expect } from 'vitest';
import { IcecastAdapter, NotImplementedError } from '../../src/adapters/streaming/icecastAdapter.js';
import type { StreamConfig, TrackMetadata } from '../../src/adapters/streaming/types.js';

const mockConfig: StreamConfig = {
  host: 'localhost',
  port: 8000,
  mountPoint: '/stream',
  password: 'hackme',
  format: 'mp3',
  bitrate: 128,
};

const mockMetadata: TrackMetadata = {
  title: 'Test Song',
  artist: 'Test Artist',
  type: 'song',
};

describe('IcecastAdapter', () => {
  it('isConnected returns false before connect is called', () => {
    const adapter = new IcecastAdapter();
    expect(adapter.isConnected()).toBe(false);
  });

  it('connect throws NotImplementedError', async () => {
    const adapter = new IcecastAdapter();
    await expect(adapter.connect(mockConfig)).rejects.toThrow(NotImplementedError);
    await expect(adapter.connect(mockConfig)).rejects.toThrow('IcecastAdapter.connect is not yet implemented');
  });

  it('sendAudio throws NotImplementedError', async () => {
    const adapter = new IcecastAdapter();
    const audio = Buffer.from('fake-audio');
    await expect(adapter.sendAudio(audio, mockMetadata)).rejects.toThrow(NotImplementedError);
    await expect(adapter.sendAudio(audio, mockMetadata)).rejects.toThrow('IcecastAdapter.sendAudio is not yet implemented');
  });

  it('disconnect throws NotImplementedError', async () => {
    const adapter = new IcecastAdapter();
    await expect(adapter.disconnect()).rejects.toThrow(NotImplementedError);
    await expect(adapter.disconnect()).rejects.toThrow('IcecastAdapter.disconnect is not yet implemented');
  });

  it('NotImplementedError has the correct name', async () => {
    const adapter = new IcecastAdapter();
    try {
      await adapter.connect(mockConfig);
    } catch (err) {
      expect(err).toBeInstanceOf(NotImplementedError);
      expect((err as NotImplementedError).name).toBe('NotImplementedError');
    }
  });

  it('dj_segment is a valid TrackType', () => {
    const meta: TrackMetadata = { title: 'Morning Show', artist: '', type: 'dj_segment' };
    expect(meta.type).toBe('dj_segment');
  });
});
