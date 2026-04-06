/**
 * IcecastAdapter — stub implementation of StreamOutputAdapter for Icecast 2.x.
 *
 * All methods throw NotImplementedError until a full implementation is written.
 * This stub exists so that the rest of the codebase can import and reference
 * the concrete type without requiring a working Icecast connection.
 *
 * To implement: replace each method body with real HTTP PUT streaming using
 * the Icecast SOURCE protocol (HTTP/1.0 PUT to /<mountPoint> with
 * Authorization: Basic <source>:<password>).
 */

import type { StreamConfig, StreamOutputAdapter, TrackMetadata } from './types.js';

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`IcecastAdapter.${method} is not yet implemented`);
    this.name = 'NotImplementedError';
  }
}

export class IcecastAdapter implements StreamOutputAdapter {
  private connected = false;

  async connect(_config: StreamConfig): Promise<void> {
    throw new NotImplementedError('connect');
  }

  async sendAudio(_audioData: Buffer, _metadata: TrackMetadata): Promise<void> {
    throw new NotImplementedError('sendAudio');
  }

  async disconnect(): Promise<void> {
    throw new NotImplementedError('disconnect');
  }

  isConnected(): boolean {
    return this.connected;
  }
}
