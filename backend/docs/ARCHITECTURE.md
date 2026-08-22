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

## Current Implementation — Step 2

Step 2 adds a minimal server-rendered UI (EJS) for creating and joining watch
rooms. Room state lives in memory only; there is no database or Redis yet.

```
User → Home (GET /) → Select Movie → POST /rooms → redirect → /room/:roomId
                                                              ↓
                                                    Other users join
```

### Routes

- `GET /` — lists the available movies (`.mp4` files in the uploads
  directory) as a movie-selection page.
- `POST /rooms` — validates the chosen movie, generates the room ID
  server-side with `crypto.randomUUID()`, sets an anonymous session cookie,
  and redirects (302) to `/room/:roomId`.
- `GET /room/:roomId` — renders the room page (video player, shareable room
  URL, copy button, admin/viewer indicator). Invalid room IDs return a 404
  page.
- `GET /movie/:id` — unchanged from Step 1. The room page points its
  `<video>` element at this endpoint; the underlying filesystem path is never
  exposed to the browser.

### Room state

Rooms are kept in an in-memory `Map` inside `RoomService`:

```ts
{
  id: string;        // server-generated UUID
  movieId: string;   // UUID of the movie being watched
  adminUserId: string; // anonymous session ID of the room creator
}
```

Playback state (play/pause, currentTime, seek) is intentionally **not** part
of the room yet — it will be layered on in a later step alongside WebSocket
synchronization.

### User identity

There is no authentication. Each visitor receives a lightweight anonymous
session ID generated with `crypto.randomUUID()` and persisted in an HttpOnly
`pw_session` cookie. The user who creates a room becomes its initial admin;
anyone else who opens the same room URL is treated as a viewer. The shared
room URL contains no secret — it is simply `/room/:roomId`.

### Templates

EJS templates live in `src/views/`:

- `home.ejs` — movie-selection page
- `room.ejs` — room page with the video player, shareable URL, copy button,
  and admin/viewer badge
- `not-found.ejs` — 404 page
- `error.ejs` — generic error page

The UI is intentionally simple: no frontend framework, just a small amount of
vanilla JavaScript for the copy-link button.

## Planned Conceptual Direction

These are future directions only. Nothing beyond Step 2 is implemented.

```
Step 1
Local video → HTTP streaming

Step 2
Watch room → server-rendered UI → in-memory room state

Step 3
WebSocket → synchronized playback

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
