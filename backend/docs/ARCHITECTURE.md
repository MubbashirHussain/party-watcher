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

## Current Implementation — Step 3

Step 3 adds a movie metadata catalog, a modern dark UI, and a file-backed
room store with named users. Room mechanics build on the anonymous session
system; there is no database, WebSocket, or authentication yet.

### Movie catalog (`data/movies.json`)

Movie metadata lives in `data/movies.json` and is the single source of truth
for the library. Actual video files and thumbnails stay inside `uploads/`.

```json
[
  {
    "id": "interstellar",
    "title": "Interstellar",
    "year": 2014,
    "duration": "2h 49m",
    "thumbnail": "interstellar.jpg",
    "filename": "interstellar.mp4"
  }
]
```

- `id` — human-friendly slug used in every URL (`/movie/:id`,
  `/movie/:id/thumbnail`) and in room creation (`POST /rooms`).
- `filename` — the MP4 inside `uploads/`.
- `thumbnail` — an image file inside `uploads/`.

`MovieCatalogService` (in `src/services/movie-catalog.service.ts`) reads and
validates the file with Zod. Duplicate ids or filenames are rejected, so a
slug always maps to exactly one file. The service is loaded once at boot in
`buildApp()` and shared by the movie and room routes. A dedicated service
keeps JSON/file-reading logic out of the EJS routes.

### Thumbnail route

`GET /movie/:id/thumbnail` validates the slug against the catalog first, then
resolves the thumbnail **inside `uploads/`** using the movie's own metadata —
no arbitrary filesystem paths are exposed. Missing thumbnails return 404 and
the UI falls back to a text placeholder on the card.

### Home page

`GET /` renders a modern dark grid of movie cards (thumbnail, title,
year · duration, "Create Room →"). A client-side search box filters cards
without a round-trip. No UUIDs are displayed; everything comes from catalog
metadata.

### Room state (`data/current.json`)

Active rooms are persisted to `data/current.json` as a map of room ID →
room. `RoomService` (`src/services/room.service.ts`) provides safe helpers to
create a room, find a room, add/rename a user, and read/write the file.
Writes are chained on a single promise so concurrent requests cannot
interleave file writes, and the file is written atomically via a temp file +
rename. A missing file starts the store empty; the `data/` directory is
created automatically.

```json
{
  "18393267846823789": {
    "movieId": "interstellar",
    "adminId": "user-uuid",
    "users": [{ "id": "user-uuid", "name": "Alex" }],
    "playback": { "paused": false, "timeline": 0, "quality": "720p" }
  }
}
```

`playback` values are stored state only — synchronization is deliberately not
implemented yet and will use this shape in a later step.

### Room creation

`POST /rooms` validates the movie against the catalog, then:

1. Generates a unique room ID (`crypto.randomUUID()`).
2. Generates a unique anonymous `userId` and persists it in the `pw_session`
   cookie.
3. Creates the room in `data/current.json` with the creator as `adminId`
   (also listed in `users` as "Host").
4. Redirects (302) to `/room/:roomId`.

The room URL contains only the room ID — never the user ID or admin info.

### Joining a room

`GET /room/:roomId` reads the visitor's `userId` cookie. If the user is
already in the room, the room renders directly. If they are new, the page
shows a name modal ("What's your name?"). Submitting it `POST`s to
`/room/:roomId/join`, which saves the name against the `userId`, adds the
user to the room's `users` list, and redirects back to the room.

Every visitor has a unique anonymous `userId` persisted in the `pw_session`
cookie. Users are never identified by IP address. No authentication is
required.

### Room page

`GET /room/:roomId` is video-first. The movie streams through the existing
`/movie/:id` endpoint (unchanged Range logic). Room details — title, host or
viewer badge, room ID, shareable URL, and a Copy button — are hidden in an
overlay by default:

- Desktop: mouse movement over the video shows the overlay; it fades out
  after 2.5 seconds of inactivity.
- Mobile: tapping the video reveals the overlay, which hides automatically.

The shareable URL remains `/room/:roomId` with no admin secret; the anonymous
`pw_session` cookie continues to determine whether the visitor is the host
(room creator) or a viewer. The overlay also shows the current user's name,
other users in the room, and the room ID.

### Static assets

Styles live in `src/public/css/app.css` (vanilla CSS, no framework) and are
served by Fastify under `/static/`. The build step copies `views/` and
`public/` into `dist/` so the production server can render and style pages.

## Planned Conceptual Direction

These are future directions only. Nothing beyond Step 3 is implemented.

```
Step 1
Local video → HTTP streaming

Step 2
Watch room → server-rendered UI → in-memory room state

Step 3
Movie catalog → dark UI → file-backed rooms with named users

Step 4
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
