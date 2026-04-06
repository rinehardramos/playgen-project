/**
 * Streaming output adapter interfaces.
 *
 * These types define the contract that any streaming output adapter (Icecast,
 * Shoutcast, etc.) must implement. See README.md in this directory for
 * implementation guidance.
 */

/** Audio format supported by the streaming server. */
export type StreamFormat = 'mp3' | 'aac' | 'ogg' | 'flac';

/** Configuration for connecting to a streaming server mount point. */
export interface StreamConfig {
  /** Hostname or IP address of the streaming server. */
  host: string;
  /** TCP port the streaming server listens on (e.g. 8000 for Icecast). */
  port: number;
  /** Mount point path on the server (e.g. "/stream"). */
  mountPoint: string;
  /** Source password for the mount point. */
  password: string;
  /** Audio format to stream. */
  format: StreamFormat;
  /** Streaming bitrate in kbps (e.g. 128, 192, 320). */
  bitrate: number;
}

/** Type of content being streamed. */
export type TrackType = 'song' | 'dj_segment';

/** Metadata sent to the streaming server for the currently playing track. */
export interface TrackMetadata {
  /** Track title (song name or DJ segment label). */
  title: string;
  /** Artist name; may be empty for DJ segments. */
  artist: string;
  /** Whether this is a music track or a generated DJ segment. */
  type: TrackType;
}

/**
 * Contract that every streaming output adapter must satisfy.
 *
 * Implementations are responsible for encoding, buffering, and transmitting
 * audio data to the streaming server, as well as updating track metadata.
 */
export interface StreamOutputAdapter {
  /**
   * Establish a connection to the streaming server using the provided config.
   * Must be called before sendAudio or updateMetadata.
   */
  connect(config: StreamConfig): Promise<void>;

  /**
   * Stream a chunk of audio data to the server.
   * @param audioData - Raw PCM or pre-encoded audio buffer.
   * @param metadata - Metadata for the track being streamed.
   */
  sendAudio(audioData: Buffer, metadata: TrackMetadata): Promise<void>;

  /**
   * Gracefully disconnect from the streaming server and release resources.
   */
  disconnect(): Promise<void>;

  /**
   * Returns true if the adapter currently has an active connection.
   */
  isConnected(): boolean;
}
