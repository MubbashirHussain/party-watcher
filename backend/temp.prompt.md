# Initialize Party Watch Codebase

You are initializing a new project called **Party Watch**.

The project is intentionally small at this stage. Do **not** over-engineer it or implement future functionality before it is requested.

## 1. Goal

Build the foundation for a private "watch with someone special" application.

The first milestone is extremely simple:

> A Node.js server reads video files from a local `/uploads` directory and streams them through an HTTP endpoint.

The first API must be:

```text
GET /movie/:id
```

Example:

```text
GET /movie/550e8400-e29b-41d4-a716-446655440000
```

The server should locate:

```text
/uploads/550e8400-e29b-41d4-a716-446655440000.mp4
```

and stream it to the client.

The video endpoint must support **HTTP Range Requests** so normal HTML5 video playback works correctly, including seeking and partial loading.

---

# 2. Important Scope Rule

This is **Step 1 only**.

Do NOT implement:

* WebSockets
* Watch rooms
* Playback synchronization
* Admin controls
* Authentication
* User accounts
* Database
* Redis
* HLS
* DASH
* Socket.IO
* Chat
* Video transcoding
* Cloud storage
* Microservices
* Docker
* Kubernetes
* Payment systems
* CDN
* Background workers
* Queue systems

The architecture should allow these features to be added later, but they must **not** be implemented now.

Do not create placeholder implementations for future functionality either.

---

# 3. Technology Stack

Use:

* Node.js
* TypeScript
* Fastify
* Zod
* Pino
* Vitest

Use modern stable versions compatible with the current Node.js LTS ecosystem.

Use native Node.js filesystem APIs for video streaming.

Do NOT introduce another framework or unnecessary dependency.

---

# 4. Project Structure

Create the project with this structure:

```text
party-watch/
│
├── .cursor/
│   └── rules/
│       ├── project.mdc
│       ├── architecture.mdc
│       ├── typescript.mdc
│       └── testing.mdc
│
├── docs/
│   ├── README.md
│   └── ARCHITECTURE.md
│
├── src/
│   ├── server.ts
│   │
│   ├── config/
│   │   └── env.ts
│   │
│   ├── routes/
│   │   └── movie.route.ts
│   │
│   ├── services/
│   │   └── movie.service.ts
│   │
│   ├── utils/
│   │   └── file.utils.ts
│   │
│   └── types/
│       └── movie.types.ts
│
├── uploads/
│   └── .gitkeep
│
├── tests/
│   └── movie/
│       └── movie.route.test.ts
│
├── .env
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

Do not create additional directories unless they are genuinely required.

---

# 5. Cursor Rules

Create the following MDC files under:

```text
.cursor/rules/
```

## `project.mdc`

Define the general project rules:

* This is a small private watch-party application.
* Prefer simple solutions.
* Do not introduce abstractions without a concrete need.
* Do not implement future features unless explicitly requested.
* Keep dependencies minimal.
* Keep modules focused.
* Avoid unnecessary design patterns.
* Do not duplicate business logic.
* Prefer readable code over clever code.

The rule should clearly state that future architecture must not influence current implementation unnecessarily.

---

## `architecture.mdc`

Define the architecture rules:

```text
Route
  ↓
Service
  ↓
Filesystem
```

Responsibilities:

### Routes

Responsible for:

* HTTP request handling
* Parameter validation
* HTTP response handling
* Calling services

Routes must NOT contain complicated filesystem logic.

### Services

Responsible for:

* Finding the requested movie
* Validating movie existence
* Obtaining file metadata
* Creating the appropriate stream

### Utils

Responsible only for reusable low-level filesystem/path helpers.

### Types

Contain shared TypeScript types.

Do not create repositories, controllers, factories, dependency injection containers, or other abstractions unless explicitly required later.

---

## `typescript.mdc`

Define TypeScript rules:

* Use strict TypeScript.
* Avoid `any`.
* Prefer explicit types for public functions.
* Use `unknown` where appropriate instead of `any`.
* Keep functions small.
* Use async/await where appropriate.
* Handle errors explicitly.
* Do not suppress TypeScript errors with `@ts-ignore` or `@ts-expect-error` unless there is a documented reason.

---

## `testing.mdc`

Define testing rules:

* Use Vitest.
* Tests should focus on observable behavior.
* Test the movie streaming endpoint.
* Test missing movies.
* Test invalid movie IDs.
* Test HTTP Range requests.
* Do not over-test implementation details.

---

# 6. Environment Configuration

Create:

```text
.env
.env.example
```

Use:

```env
PORT=3000
UPLOAD_DIR=./uploads
```

`src/config/env.ts` should validate environment variables with Zod.

Do not hardcode the upload directory or port in application logic.

`.env` should be ignored by Git.

`.env.example` should be committed.

---

# 7. Movie Identification

For Step 1, movie files use UUID-based filenames:

```text
/uploads/<uuid>.mp4
```

Example:

```text
/uploads/550e8400-e29b-41d4-a716-446655440000.mp4
```

The API receives:

```text
/movie/:id
```

Validate the ID as a UUID using Zod.

Only allow the expected movie format.

Do not accept arbitrary filesystem paths.

The implementation must prevent path traversal attacks such as:

```text
/movie/../../secret
```

or any equivalent traversal technique.

---

# 8. Video Streaming

Implement:

```text
GET /movie/:id
```

The endpoint must:

1. Validate `id`.
2. Resolve the corresponding `.mp4` file inside the configured upload directory.
3. Check whether the file exists.
4. Read file metadata.
5. Detect the HTTP `Range` header.
6. Return a `206 Partial Content` response when a valid range is requested.
7. Return the appropriate `Content-Range`.
8. Return `Accept-Ranges: bytes`.
9. Return the appropriate `Content-Length`.
10. Return `Content-Type: video/mp4`.
11. Stream the file using `fs.createReadStream()`.
12. Avoid loading the entire video into memory.

For requests without a Range header, return a normal streaming response.

Handle invalid ranges appropriately.

Do not use:

```text
fs.readFile()
```

to load the complete video into memory.

---

# 9. HTTP Behavior

The endpoint should provide correct HTTP semantics.

Expected behavior:

### Existing movie

```text
200 OK
```

for a normal request.

### Range request

```text
206 Partial Content
```

with appropriate:

```text
Accept-Ranges
Content-Range
Content-Length
Content-Type
```

### Movie does not exist

Return:

```text
404 Not Found
```

with a small JSON error response.

### Invalid UUID

Return:

```text
400 Bad Request
```

with a JSON error response.

### Invalid range

Return an appropriate HTTP error response rather than attempting to create an invalid stream.

Do not expose internal filesystem paths in API errors.

---

# 10. Logging

Use Pino through Fastify's logging integration.

Log useful events such as:

* Server startup
* Movie request
* Movie not found
* Invalid request
* Streaming errors

Do not log sensitive information unnecessarily.

Do not log the full filesystem path if it exposes unnecessary server internals.

---

# 11. Error Handling

Implement centralized Fastify error handling where appropriate.

Errors returned to clients should be simple and safe.

Example:

```json
{
  "error": "Movie not found"
}
```

Do not expose:

* stack traces
* absolute filesystem paths
* internal implementation details

in production responses.

---

# 12. Testing

Create tests using Vitest.

At minimum test:

### Test 1 — Movie streaming

Given a test MP4 file:

```text
/uploads/test-movie.mp4
```

verify that the endpoint can return the movie stream.

### Test 2 — Missing movie

Request a valid UUID that does not exist and verify:

```text
404
```

### Test 3 — Invalid UUID

Request:

```text
/movie/not-a-uuid
```

and verify:

```text
400
```

### Test 4 — Range request

Send a request with something similar to:

```http
Range: bytes=0-1023
```

and verify:

```text
206
```

and appropriate range headers.

Tests should not depend on a real large movie file.

Create a small test fixture if necessary.

---

# 13. README

The root `README.md` should contain only concise project-level information.

Include:

* Project name
* Purpose
* Requirements
* Installation
* Development commands
* Environment variables
* How to add a movie
* API example
* Current scope

Example usage:

```text
npm install
npm run dev
```

Then:

```text
GET http://localhost:3000/movie/<uuid>
```

---

# 14. Documentation

All project documentation files other than the root README should live inside:

```text
/docs
```

Create:

```text
docs/README.md
docs/ARCHITECTURE.md
```

`docs/ARCHITECTURE.md` should explain the current architecture and explicitly document that this is **Step 1**.

It should also describe the planned conceptual direction without implementing it:

```text
Step 1
Local video → HTTP streaming

Step 2
Watch session → WebSocket → synchronized playback

Future
Admin controls → play/pause/seek/quality
```

Do not implement Step 2.

---

# 15. Package Scripts

Provide useful scripts such as:

```json
{
  "dev": "...",
  "build": "...",
  "start": "...",
  "test": "...",
  "test:watch": "...",
  "typecheck": "..."
}
```

Use an appropriate development runner for TypeScript.

The production build should compile cleanly.

---

# 16. Code Quality

Before finishing:

* Run the TypeScript type checker.
* Run tests.
* Run the production build.
* Fix all errors.
* Make sure there are no unnecessary dependencies.
* Make sure imports are clean.
* Make sure `.env` is ignored.
* Make sure `/uploads` itself remains in Git through `.gitkeep`.
* Make sure no generated build artifacts are committed.

---

# 17. Important Future Constraint

The application will eventually support synchronized watch sessions.

The conceptual future architecture is:

```text
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

The server will eventually become the source of truth for:

```text
play / pause
current timeline
seek
video
quality
```

However, **do not implement any of this now**.

The current implementation should simply provide a reliable video streaming foundation that can later be integrated with a watch-session system.

---

# 18. Final Verification

After implementation, verify:

```text
npm install
npm run typecheck
npm test
npm run build
```

All must pass.

Also manually verify:

1. Put an MP4 file inside `/uploads`.
2. Rename it to a UUID-based filename.
3. Start the server.
4. Open the `/movie/:id` endpoint in a browser/video player.
5. Confirm playback works.
6. Confirm seeking works.
7. Confirm the browser can request byte ranges.
8. Confirm missing files return 404.
9. Confirm invalid IDs return 400.

---

# 19. Agent Behavior Rules

Before modifying files:

1. Inspect the existing repository.
2. Do not overwrite existing user code unnecessarily.
3. If this is an empty repository, initialize the project according to this specification.
4. If something already exists, adapt it instead of blindly recreating it.
5. Do not add features outside the requested scope.
6. Do not ask for permission for normal implementation decisions covered by this specification.
7. If a dependency is genuinely necessary, use the smallest reasonable option.
8. Keep the implementation simple and production-quality.
9. Do not create speculative abstractions for future features.
10. At the end, report exactly what was created, what was tested, and any remaining issues.

## Definition of Done

The project is complete when:

```text
Node.js + TypeScript project
        ↓
Fastify server
        ↓
GET /movie/:id
        ↓
UUID validation
        ↓
Safe file resolution
        ↓
HTTP Range support
        ↓
Streaming via createReadStream()
        ↓
Tests passing
        ↓
TypeScript build passing
```

Do not proceed beyond this milestone.
