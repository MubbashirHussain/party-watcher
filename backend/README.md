# Party Watch

A small private application for watching videos with someone special.

**Current scope (Steps 1–2):** A Node.js server that streams MP4 files from a
local `uploads` directory over HTTP (with full HTTP Range support), plus a
minimal server-rendered UI for creating and sharing watch rooms.

## Requirements

- Node.js >= 20

## Installation

```bash
npm install
```

## Development

```bash
npm run dev        # start dev server with watch mode
npm run typecheck  # type-check the project
npm test           # run tests
npm run build      # production build (outputs to dist/)
npm start          # run the production build
```

## Environment Variables

Copy `.env.example` to `.env` if it does not exist:

| Variable     | Default       | Description              |
| ------------ | ------------- | ------------------------ |
| `PORT`       | `3000`        | HTTP port                |
| `UPLOAD_DIR` | `./uploads`   | Directory with movie files |

## Adding a Movie

Place an MP4 file in `uploads/` and name it after a UUID:

```text
uploads/550e8400-e29b-41d4-a716-446655440000.mp4
```

You can generate a UUID with:

```bash
node -e "console.log(crypto.randomUUID())"
```

## Using the App

1. Open <http://localhost:3000/> — the home page lists the movies found in
   `uploads/`.
2. Pick a movie — the server creates a watch room and redirects you to
   `/room/:roomId`.
3. Share the room URL with someone else. Anyone who opens the same URL sees
   the same movie page.

The user who creates a room becomes its admin; other visitors are viewers.
There is no authentication — visitors are tracked with an anonymous session
cookie. Room state lives in memory and is lost on restart.

## API

```http
GET /movie/:id
```

Example:

```bash
curl -i http://localhost:3000/movie/550e8400-e29b-41d4-a716-446655440000
```

The endpoint supports HTTP Range requests, so HTML5 `<video>` playback and
seeking work in browsers.

## Current Scope

Steps 1–2 only: local video streaming over HTTP and the watch-room + UI
foundation. WebSockets, playback synchronization, chat, and a database are
not implemented yet.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for details.
