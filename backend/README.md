# Party Watch

A small private application for watching videos with someone special.

**Current scope (Step 1):** A Node.js server that streams MP4 files from a local
`uploads` directory over HTTP, with full support for HTTP Range requests.

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

Step 1 only: local video streaming over HTTP. Watch sessions, WebSockets,
synchronization, and related features are not implemented yet.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for details.
