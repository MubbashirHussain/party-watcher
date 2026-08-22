# Architecture

## Current Implementation — Step 1

Step 1 is intentionally small: a Node.js server reads video files from a local
`/uploads` directory and streams them over HTTP.

```
GET /movie/:id
        ↓
   Fastify route        (validates UUID, handles HTTP responses)
        ↓
   Movie service        (finds the file, checks existence, reads metadata)
        ↓
   Filesystem           (fs.createReadStream, native Node.js APIs)
```

### Responsibilities

- **Routes** — HTTP handling, parameter validation, responses. No complicated
  filesystem logic.
- **Services** — locate the movie, validate existence, obtain metadata, create
  the stream.
- **Utils** — reusable low-level filesystem/path helpers.
- **Types** — shared TypeScript types.

### Streaming

- `GET /movie/:id` locates `<uploadDir>/<uuid>.mp4`.
- The ID is validated as a UUID (Zod) to prevent path traversal.
- The file path is resolved inside the configured upload directory only.
- Full requests stream with `200 OK` and `Accept-Ranges: bytes`.
- Range requests return `206 Partial Content` with `Content-Range`.
- Streaming uses `fs.createReadStream()` — the video is never fully loaded
  into memory.

## Planned Conceptual Direction

These are future directions only. Nothing beyond Step 1 is implemented.

```
Step 1
Local video → HTTP streaming

Step 2
Watch session → WebSocket → synchronized playback

Future
Admin controls → play/pause/seek/quality
```

The server will eventually become the source of truth for:

- play / pause
- current timeline
- seek
- video
- quality

### Conceptual Future Architecture

```
                    Node.js
                       │
             ┌─────────┴─────────┐
             │                   │
        Video API           Watch Sessions
             │                   │
        HTTP Stream          WebSocket
             │                   │
         Movie File       Admin + Viewers
```
