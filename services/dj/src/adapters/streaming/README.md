# Streaming Output Adapters

This directory contains the streaming output adapter interface and stub implementations.
Streaming adapters are responsible for sending encoded audio data to a live radio
streaming server (Icecast, Shoutcast, etc.) and keeping the server's "Now Playing"
metadata in sync.

## Interfaces

See [`types.ts`](./types.ts) for the full TypeScript definitions.

| Interface | Purpose |
|---|---|
| `StreamConfig` | Connection parameters (host, port, mount, password, format, bitrate) |
| `TrackMetadata` | Per-track info sent to the server (title, artist, type) |
| `StreamOutputAdapter` | The contract every adapter must implement |

## StreamOutputAdapter contract

```ts
interface StreamOutputAdapter {
  connect(config: StreamConfig): Promise<void>;
  sendAudio(audioData: Buffer, metadata: TrackMetadata): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
```

## Implementing a new adapter

1. Create a new file in this directory, e.g. `shoutcastAdapter.ts`.
2. Import and implement `StreamOutputAdapter` from `./types.js`.
3. `connect()` — open a persistent TCP/HTTP connection to the server using the
   supplied `StreamConfig`. Store the connection handle on the instance and set
   an internal `_connected` flag.
4. `sendAudio()` — write the encoded audio buffer to the open connection.
   Update track metadata via the server's metadata endpoint if applicable.
5. `disconnect()` — flush any buffered data, close the connection, and reset
   the internal flag.
6. `isConnected()` — return the internal flag without side effects.

### Icecast 2.x notes

Icecast uses the HTTP SOURCE protocol: open an HTTP/1.0 `PUT` (or legacy
`SOURCE`) request to `http://<host>:<port>/<mountPoint>` with:

```
Authorization: Basic <base64("source:<password>")>
Content-Type: audio/mpeg          # or audio/aac, application/ogg
ice-name: <station name>
ice-description: <station description>
```

Keep the connection open and stream raw encoded audio bytes. To update "Now
Playing" metadata, send a separate `GET` request to:

```
/admin/metadata?mount=/<mountPoint>&mode=updinfo&song=<artist>+-+<title>
```

### Shoutcast v2 notes

Shoutcast v2 uses a similar HTTP-based protocol. Connect to
`http://<host>:<port>/` with `Authorization: Basic <base64("admin:<password>")>`
and stream to `/stream/<sid>`. Metadata updates go to `/currentsong`.

## Stub

`IcecastAdapter` in [`icecastAdapter.ts`](./icecastAdapter.ts) is a stub that
throws `NotImplementedError` on every method except `isConnected()` (which
safely returns `false`). It is provided so the type system has a concrete class
to reference before a real implementation exists.
