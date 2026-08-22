# Party Watch

A small private application for watching videos with someone special.

**Current scope (Steps 1–3):** A Node.js server that streams MP4 files from a
local `uploads` directory over HTTP (with full HTTP Range support), a movie
catalog in `data/movies.json`, and a modern dark server-rendered UI for
browsing movies and sharing watch rooms.

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

| Variable      | Default               | Description                |
| ------------- | --------------------- | -------------------------- |
| `PORT`        | `3000`                | HTTP port                  |
| `UPLOAD_DIR`  | `./uploads`           | Directory with movie files |
| `MOVIES_FILE` | `./data/movies.json`  | Movie metadata catalog     |

## Adding a Movie

1. Place the MP4 in `uploads/`.
2. Place a thumbnail image in `uploads/`.
3. Add an entry to `data/movies.json`:

```json
{
  "id": "interstellar",
  "title": "Interstellar",
  "year": 2014,
  "duration": "2h 49m",
  "thumbnail": "interstellar.jpg",
  "filename": "interstellar.mp4"
}
```

The `id` (a slug) is used in URLs and room creation. `filename` and
`thumbnail` are file names inside `uploads/` — the app never exposes
filesystem paths to the browser.

## Using the App

1. Open <http://localhost:3000/> — the home page shows a searchable grid of
   movies from the catalog.
2. Pick a movie — the server creates a watch room and redirects you to
   `/room/:roomId`.
3. Share the room URL with someone else. Anyone who opens the same URL sees
   the same movie page.
4. Move the mouse over the video (or tap it on mobile) to reveal the room
   overlay: movie title, host/viewer status, room ID, and a copy-link button.

The user who creates a room becomes its host; other visitors are viewers.
There is no authentication — visitors are tracked with an anonymous session
cookie. Room state lives in memory and is lost on restart.

## API

```http
GET /movie/:id
GET /movie/:id/thumbnail
```

Example:

```bash
curl -i http://localhost:3000/movie/interstellar
```

The video endpoint supports HTTP Range requests, so HTML5 `<video>` playback
and seeking work in browsers.

## Current Scope

Steps 1–3 only: local video streaming, the movie catalog + dark UI, and the
watch-room foundation. WebSockets, playback synchronization, chat, and a
database are not implemented yet.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for details.
