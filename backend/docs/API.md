# Party Watch — API & EJS SSR Documentation

This document describes the **full request flow for every API route** and how the
**frontend is rendered using EJS server-side rendering (SSR)**.

**Stack:** Node.js + Fastify · EJS (SSR) · JSON-file persistence · vanilla JS/CSS.
There is **no database, no authentication, no WebSockets** (playback sync is planned for a future step).

---

## 1. Architecture at a Glance

```
Browser ──HTTP──▶ Fastify Server (src/server.ts)
                     │  buildApp() constructs services & injects them into route plugins
                     ├─ MovieCatalogService  (loads data/movies.json once at boot)
                     ├─ RoomService          (file-backed CRUD on data/current.json)
                     ├─ roomRoutes           (home, room create/join/view + EJS view engine)
                     ├─ movieRoutes          (MP4 streaming + thumbnail streaming)
                     └─ @fastify/static      (serves /static/css/app.css)
```

Startup order inside `buildApp()`:

1. `loadEnv()` parses env via Zod (`PORT`, `UPLOAD_DIR`, `MOVIES_FILE`, `ROOMS_FILE`).
2. `new MovieCatalogService().load(MOVIES_FILE)` — catalog loaded once at boot.
3. `new RoomService(ROOMS_FILE).init()` — rooms loaded from disk.
4. Register a global error handler → `500 { error: 'Internal server error' }`.
5. Register plugins: `@fastify/static`, `@fastify/cookie`, `@fastify/formbody`,
   `roomRoutes`, `movieRoutes`.
6. If run directly: `app.listen({ port, host: '0.0.0.0' })`.

Dependency injection is done via Fastify plugin `opts`, keeping services testable and decoupled from HTTP.

---

## 2. API Routes

### Route Summary

| Method | Path                   | Handler                         | Response              |
| --------| ------------------------| ---------------------------------| -----------------------|
| GET    | `/`                    | render home grid                | 200 HTML (`home.ejs`) |
| POST   | `/rooms`               | create room (public/private) + cookie | 302 → `/room/:id` |
| GET    | `/room/:roomId`        | render room page (lock screen for locked private rooms) | 200 HTML (`room.ejs`) |
| POST   | `/room/:roomId/password` | unlock a private room          | 303 → `/room/:id` or `?pwError=1` |
| POST   | `/room/:roomId/join`   | add / rename user               | 302 → `/room/:id`     |
| GET    | `/movie/:id`           | stream MP4 (HTTP Range support) | 200 / 206 / 416       |
| GET    | `/movie/:id/thumbnail` | stream JPEG thumbnail           | 200 / 404             |
| GET    | `/static/*`            | static assets (CSS)             | CSS                   |

---

### 2.1 `GET /` — Home / movie grid

Renders `home.ejs` with every movie in the catalog.

```js
reply.view('home', { movies: catalog.getAll() });
```

The page shows a searchable grid of movie cards. Each card has a thumbnail
(`/movie/<id>/thumbnail`) and a **"Create Room →"** form that POSTs `movieId` to `/rooms`.

---

### 2.2 `POST /rooms` — Create a watch room

Flow:

1. **Validate** body `{ movieId, visibility?, password? }` against
   `createRoomBodySchema` (slug regex `/^[a-z0-9-]+$/`, `visibility` defaults
   to `public`, password 4–72 chars, required when `visibility = private`).
   Invalid → **400** `error.ejs`.
2. **Confirm movie exists** via `getMovie(catalog, UPLOAD_DIR, movieId)`.
   - `MovieNotFoundError` / `MovieNotInCatalogError` → **404** `not-found.ejs`.
   - This checks both the catalog entry **and** that the MP4 exists on disk.
3. **Anonymous session** — `getOrCreateUserId(request, reply)` reads or sets the `pw_session` cookie.
4. **Create the room** — `rooms.createRoom(movieId, userId, { visibility, password })`:
   - `id = randomUUID()`
   - Creator becomes the admin and is auto-added as a user named `"Host"`.
   - Public rooms store `visibility: "public"` (the default for rooms created
     before visibility existed).
   - Private rooms store `visibility: "private"`, a **bcrypt hash** of the
     password (`passwordHash`, never plaintext), and an opaque `accessToken`
     used for the unlock cookie.
   - `playback = { paused: false, timeline: 0, quality: '720p' }` (stored only).
   - Persists to `data/current.json`.
5. **Redirect** → `302 /room/<id>`.

```js
reply.redirect(`/room/${room.id}`);
```

---

### 2.3 `GET /room/:roomId` — View a room

Flow:

1. **Validate** `roomId` (UUID shape). Invalid → **404** `not-found.ejs`.
2. **Look up room** — `rooms.getRoom(roomId)`; `RoomNotFoundError` → **404** (`"Room not found. It may have expired…"`).
3. **Look up movie** — `catalog.getBySlug(room.movieId)`; failure → **404**.
4. **Derive user state** from the `pw_session` cookie:
   - `isAdmin` = `userId === room.adminId`
   - `userInRoom` = whether the user is in `room.users`
   - `roomUrl` = absolute shareable URL (`${protocol}://${host}/room/${id}`).
   - `needsPassword` = room is private **and** the visitor is not the admin,
     not already in the room, and does not hold the room's access-token cookie.
5. **Render** `room.ejs` with
   `roomId, movieId, movieTitle, movieYear, movieDuration, roomUrl, isAdmin, userName, roomUsers, roomVisibility, needsPassword, passwordError`.

- If `needsPassword` is **true**, the template renders a **lock screen**
  (password form) instead of the video player and join modal.
- If the user has access but `userName` is **not set**, the template shows a
  **name modal** (join form).
- The `<video src="/movie/<movieId>">` streams from the movie route. Note that
  the raw `/movie/:id` endpoint is intentionally **not** password-gated (the
  same stream serves every room for a movie) — privacy is enforced at the room
  page/join layer.

---

### 2.4 `POST /room/:roomId/password` — Unlock a private room

Flow:

1. **Validate** `roomId` (UUID). Invalid → **404**.
2. **Look up room** → **404** if missing. Public rooms redirect straight back.
3. **Validate body** `{ password }` (1–72 chars). Invalid → **303** `?pwError=1`.
4. **Verify** `rooms.isPasswordCorrect(roomId, password)` (bcrypt compare
   against the stored hash; always false for public rooms).
   - Wrong password → **303** `/room/<id>?pwError=1` — the lock screen then
     shows a generic "That password is incorrect." message. The password is
     never echoed back.
5. **Grant access** — `rooms.ensureAccessToken(roomId)` returns the room's
   access token, then `setRoomAccessCookie(reply, roomId, token)` sets an
   httpOnly cookie `pw_room_<roomId> = <token>` scoped to `path: /room/<roomId>`
   (30 days). Because the cookie value must equal the token stored on the room
   record, the cookie cannot be forged.
6. **Redirect** → **303** `/room/<id>` (PRG — refresh won't re-submit the form).

The password only ever travels in the POST body, never in the URL.

---

### 2.5 `POST /room/:roomId/join` — Join a room with a name

Flow:

1. **Validate** `roomId` (UUID). Invalid → **404**.
2. **Look up room** → **404** if missing.
3. **Gate private rooms** — if the room is private and the visitor is not the
   admin, not already in the room, and has no access cookie, redirect
   (302) to `/room/<id>` (the lock screen). This prevents bypassing the
   password modal by POSTing straight to `/join`.
4. **Validate body** `{ name }` (trimmed, 1–40 chars). Invalid → **400**.
5. **Get/create session** cookie (`getOrCreateUserId`).
6. **Add/rename user** — `rooms.addUser(room.id, userId, name)`:
   - Adds the user if new, or **updated the display name** if already present.
   - Persists to `data/current.json`.
7. **Redirect** → `302 /room/<id>`.

Revisiting the room now renders `room.ejs` **without** the modal and shows the user's name.

---

### 2.6 `GET /movie/:id` — MP4 streaming (HTTP Range)

Full streaming with `fs.createReadStream` — never loads the file into memory.

1. **Validate** slug → **400** `{ error: 'Invalid movie ID' }`.
2. **Resolve** `getMovie(catalog, UPLOAD_DIR, id)` → **404** `{ error: 'Movie not found' }` on catalog miss or missing file.
   - Includes a path-traversal guard and a symlink guard.

**No `Range` header** → streams whole file:

```
200 · Accept-Ranges: bytes · Content-Type: video/mp4 · Content-Length: <size>
```

**With `Range` header** (`bytes=start-end`), supports:

| Case | Parsing | Response |
|------|---------|----------|
| Full / open-ended | `bytes=0-` | `206`, `Content-Range: bytes 0-(size-1)/size` |
| Suffix range | `bytes=-N` (last N bytes) | `206` with computed start |
| End clamping | end > size | clamp end to `size - 1` |
| Unsatisfiable / malformed | start ≥ size | **416**, `Content-Range: bytes */<size>` |

This is what enables **seeking** in the `<video>` element.

---

### 2.6 `GET /movie/:id/thumbnail` — JPEG thumbnail

1. **Validate** slug → **400** `{ error: 'Invalid movie ID' }`.
2. `catalog.getBySlug(id)` → **404** `{ error: 'Movie not found' }`.
3. `resolveFilePath(UPLOAD_DIR, metadata.thumbnail)` (path-traversal-safe join).
4. Stream the file with `Content-Type: image/jpeg` + `Content-Length`.
5. Missing file → **404** `{ error: 'Thumbnail not found' }`.

Used by the `<img src="/movie/<id>/thumbnail">` in the home grid.

---

## 3. Services

### MovieCatalogService (`src/services/movie-catalog.service.ts`)

- Loads & validates `data/movies.json` with a Zod `.strict()` schema
  (`id, title, year, duration, thumbnail, filename` — filename must end `.mp4`).
- Stores movies in `Map<slug, MovieMetadata>` + `Set<filename>`.
  **Duplicate ids or filenames throw `CatalogError`** so a slug always maps to one file.
- API: `load(path)`, `getAll()`, `getBySlug(slug)`, `getByFilename(filename)`.

### MovieService (`src/services/movie.service.ts`)

`getMovie(catalog, uploadDir, slug)`:

1. `catalog.getBySlug(slug)` → metadata.
2. `resolveFilePath(uploadDir, filename)` (path-traversal guard).
3. Symlink guard — resolved path must stay under `uploadDir`.
4. `stat()` must be a regular file else `MovieNotFoundError`.
5. Returns `{ id, filename, filePath, size }`.

### RoomService (`src/services/room.service.ts`)

- File-backed store (`RoomStore = Record<roomId, Room>`) persisted to `data/current.json`.
- **Concurrency-safe:** each mutation applies to the in-memory snapshot then writes through a single
  `writeChain` promise, so concurrent requests cannot interleave file writes.
- Rooms loaded from disk default to `visibility: "public"` when the field is
  missing, so rooms created before visibility existed keep working unchanged.
- API: `init()`, `createRoom(movieId, adminId, options?)`,
  `getRoom(roomId)`, `isUserInRoom(roomId, userId)`,
  `isPasswordCorrect(roomId, password)`, `ensureAccessToken(roomId)`,
  `addUser(roomId, userId, name)`.
- `createRoom` accepts `{ visibility?: 'public' | 'private', password?: string }`.
  Private rooms hash the password with bcrypt (cost 12) and generate an
  opaque `accessToken`; the plaintext is never stored.
- Errors: `RoomNotFoundError`, `RoomStoreError`, `RoomPasswordRequiredError`.

---

## 4. Data Models

### MovieMetadata (`movie-metadata.types.ts`)

```ts
{
  id: string;        // slug, e.g. "interstellar" (used in URLs)
  title: string;     // "Interstellar"
  year: number;      // 2014
  duration: string;  // "2h 49m"
  thumbnail: string; // "interstellar.jpg"
  filename: string;  // "interstellar.mp4"
}
```

### Room / RoomUser / PlaybackState / RoomStore (`room.types.ts`)

```ts
RoomVisibility  'public' | 'private'
RoomUser        { id: string; name: string }
PlaybackState   { paused: boolean; timeline: number; quality: string }
Room            {
  id: string;
  movieId: string;
  adminId: string;
  visibility: RoomVisibility;       // 'public' (default) or 'private'
  passwordHash?: string;            // bcrypt hash — private rooms only, never plaintext
  accessToken?: string;             // opaque token for the pw_room_<id> unlock cookie
  users: RoomUser[];
  playback: PlaybackState;
}
RoomStore       Record<string, Room>   // shape of data/current.json
```

`data/current.json` starts empty (`{}`). Playback state is **stored but never mutated by any
route** — synchronization is planned for a future WebSocket step.

Example private room:

```json
{
  "room-id": {
    "id": "room-id",
    "movieId": "interstellar",
    "adminId": "user-uuid",
    "visibility": "private",
    "passwordHash": "$2b$12$...",
    "accessToken": "token-uuid",
    "users": [{ "id": "user-uuid", "name": "Host" }],
    "playback": { "paused": false, "timeline": 0, "quality": "720p" }
  }
}
```

---

## 5. Session Management (`src/utils/session.utils.ts`)

- **No authentication.** Each visitor gets an anonymous opaque ID.
- Cookie: `pw_session` = `randomUUID()`.
- `getOrCreateUserId(request, reply)`:
  - Returns existing `pw_session` if present.
  - Otherwise generates one and sets the cookie with:
    `httpOnly: true` · `sameSite: 'lax'` · `path: '/'` · `maxAge: 30 days`.
- The ID determines room admin membership (`userId === room.adminId`) and attaches a display
  name per room (`room.users`). Clearing the cookie re-assigns a new ID (adminship is best-effort for the MVP).
- **Private-room access:** after the password is verified, the room's stored
  `accessToken` is set in an httpOnly cookie `pw_room_<roomId>` scoped to
  `path: /room/<roomId>` (30 days). `hasRoomAccess(request, roomId, token)`
  checks strict equality against the room's stored token, so the cookie
  cannot be forged. The room creator (admin) and users already in the room
  never need it.

---

## 6. Frontend — EJS SSR

### View engine setup (`room.route.ts`)

```ts
app.register(view, {
  engine: { ejs },
  root: join(__dirname, '..', 'views'),
});
```

- `@fastify/view` is registered inside the room routes plugin with `ejs`.
- Templates live in `src/views` (dev via `tsx`) or `dist/views` (prod; the build copies them).
- Rendering uses `reply.view('templateName', { data })`.
- **No shared layout/partials** — each template is a complete standalone HTML document that
  duplicates the `<head>` and links the shared stylesheet, and repeats the simple-page markup where needed.

### Template files

| Template | Purpose | Data passed |
|----------|---------|-------------|
| `home.ejs` | Searchable movie grid; each card has a "Create Room →" form with Public/Private + password field | `{ movies }` |
| `room.ejs` | Watch page: `<video>`, overlay, name modal, password lock screen, share URL + Copy button | `{ roomId, movieId, movieTitle, movieYear, movieDuration, roomUrl, isAdmin, userName, roomUsers, roomVisibility, needsPassword, passwordError }` |
| `not-found.ejs` | 404 page | `{ message }` |
| `error.ejs` | Generic error page | `{ message }` |

### `home.ejs`

- Full HTML page, title "Party Watch", links `/static/css/app.css`.
- Hero section + client-side search input.
- Movie grid generated with a `<% for (const movie of movies) %>` loop:
  - `<img src="/movie/<%= movie.id %>/thumbnail">` with a JS `onerror` fallback to a text div.
  - Title, `year · duration`.
  - `<form method="post" action="/rooms">` with a hidden `movieId` input,
    a **Public/Private** radio toggle (Public checked by default), and a
    password field that only appears when Private is selected (small inline
    vanilla JS toggles it and clears the value when switching back).
- Empty state if `movies.length === 0`.
- Inline vanilla JS filters the cards by `data-title` on input (no round-trip).

### `room.ejs`

- Title `<%= movieTitle %> · Party Watch`.
- When `needsPassword` is true, renders a **lock screen** instead of the
  player: lock icon, "This room is private", a password form posting to
  `/room/<roomId>/password`, and an inline error when `passwordError` is set
  (the input is never prefilled). The video element and player script are
  omitted entirely.
- Otherwise the full player renders:
  - `<video id="videoElement" src="/movie/<%= movieId %>">` — streams via the movie route.
  - Overlay (hidden by default, shows on mouse move / touch):
    - Movie title + Host/Viewer badge (`isAdmin`) + a **Private** badge for
      private rooms (`roomVisibility`), `year · duration`.
    - Room ID, participant avatars, shareable `roomUrl` + **Copy** button
      (clipboard API with `document.execCommand` fallback).
  - If `!userName`, a **name modal** renders:
    `<form method="post" action="/room/<%= roomId %>/join">` with a `name` input
    (maxlength 40, required, autofocus).
- Overlay show/hide (3 s auto-hide) and copy handler are inline vanilla JS.

### Static assets

- Served under `/static/` by `@fastify/static` from `src/public` (dev) or `dist/public` (prod).
- A single asset: **`src/public/css/app.css`** (dark theme, CSS custom properties).
- **No client-side JS/image/font files are served statically** — all page scripts are inline in
  the EJS templates, and thumbnails come from the dynamic `/movie/:id/thumbnail` route.

---

## 7. End-to-End Request Flows

### Browse & create a room

```
GET /
  → home.ejs rendered from catalog
  → click "Create Room →" (movieId=interstellar, visibility=public|private, password?)
POST /rooms
  → Zod validate movieId/visibility/password
  → getMovie() (catalog + file check)
  → pw_session cookie created
  → rooms.createRoom() (bcrypt hash + access token for private) → data/current.json written
  → 302 /room/<uuid>
```

### Join a public room

```
GET /room/<uuid>  (no cookie / not in room)
  → room + movie metadata looked up
  → room.ejs rendered WITH name modal
  → submit name → POST /room/<uuid>/join
  → cookie set (if new) → rooms.addUser() → data/current.json updated
  → 302 back to /room/<uuid> → room.ejs rendered WITHOUT modal, shows user name
```

### Join a private room

```
GET /room/<uuid>  (visitor without access)
  → room.ejs rendered as LOCK SCREEN (no player, no join modal)
  → submit password → POST /room/<uuid>/password
  → wrong → 303 /room/<uuid>?pwError=1 → lock screen shows error
  → correct → 303 /room/<uuid> + Set-Cookie pw_room_<uuid>=<token> (HttpOnly, path=/room/<uuid>)
  → GET /room/<uuid> now shows player + name modal
  → submit name → POST /room/<uuid>/join (gated on the access cookie)
  → 302 back to /room/<uuid> → player WITHOUT modal, shows user name
```

### Video playback

```
GET /room/<uuid>
  → <video src="/movie/interstellar">
GET /movie/interstellar            (no Range)       → 200 full stream
GET /movie/interstellar            (Range: bytes=0-1048575) → 206 + Content-Range (seekable)
GET /movie/interstellar/thumbnail                     → 200 image/jpeg stream
```

---

## 8. Security Notes

- URLs only ever expose **slugs** (`/movie/<slug>`, `/room/<uuid>`), never filesystem paths.
- Every param and body is validated with **Zod schemas**.
- Room passwords are hashed with **bcrypt (cost 12)** and never stored or
  echoed as plaintext. The password travels only in the POST body, never the
  URL. A wrong password shows a generic error.
- Private-room access is enforced at the room page and join route: a visitor
  without the access cookie gets a lock screen, and `POST /join` refuses
  private rooms that haven't been unlocked. The access cookie
  (`pw_room_<roomId>`) is HttpOnly, scoped to the room, and must match the
  room's stored token — it cannot be forged.
- The raw `/movie/:id` stream is not password-gated (the same stream serves
  every room for a movie); privacy is enforced at the room/join layer.
- `resolveFilePath` blocks `../` path traversal; `getMovie` adds a symlink-path check.
- Cookies are `httpOnly` + `sameSite: lax`.
- Files are streamed with `createReadStream`, never buffered into memory.