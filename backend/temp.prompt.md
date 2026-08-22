# Step 2 — Room Creation & Server-Rendered UI

The previous implementation already completed **Step 1: local MP4 streaming via `GET /movie/:id`**.

Do **not rewrite or replace the existing implementation**. Extend it with the following MVP functionality.

## Goal

Add a minimal server-rendered UI using **EJS** so users can:

1. Open `/`
2. See the movies available in `/uploads`
3. Select a movie
4. Create a watch room
5. Get redirected to `/room/:roomId`
6. Copy/share that room URL
7. Other users can open the same URL and see the same room page

## New Flow

```text
GET /
   ↓
Movie list
   ↓
Create Room
   ↓
POST /rooms
   ↓
Server generates UUID
   ↓
Redirect → /room/:roomId
```

The **server must generate the room ID** using a secure UUID generator such as:

```ts
crypto.randomUUID()
```

Do not ask the client to generate room IDs.

## Room State

For this MVP, keep room state **in memory**. No database or Redis.

A room should minimally contain:

```ts
{
  id: string;
  movieId: string;
  adminUserId: string;
}
```

Design the room state so playback state can be added later.

## User Identity

Do not implement authentication.

Generate a lightweight anonymous user/session ID and persist it using a cookie.

The user who creates the room becomes the initial admin.

Do NOT put an admin secret/key in the room URL.

The shared URL should simply be:

```text
/room/:roomId
```

## Server-Rendered Pages

Use EJS templates.

Add:

```text
GET /
```

Render a movie-selection page showing available `.mp4` files from `/uploads`.

Add:

```text
POST /rooms
```

Create the room and redirect to:

```text
GET /room/:roomId
```

The room page should:

* Show the selected movie
* Render the video player
* Show the room URL
* Provide a copy-link button
* Indicate whether the current visitor is the admin
* Use the existing `/movie/:id` streaming endpoint for video playback

The movie URL must **not be exposed as a direct filesystem/storage URL**.

## Templates

Add a simple structure such as:

```text
src/
└── views/
    ├── home.ejs
    └── room.ejs
```

Keep the UI intentionally simple. No frontend framework.

Small vanilla JavaScript is fine for:

* Copying the room URL
* Basic UI interactions

## Routes

Add only what is required:

```text
GET  /
POST /rooms
GET  /room/:roomId
```

Keep the existing:

```text
GET /movie/:id
```

unchanged unless a small integration change is genuinely required.

## Room Not Found

If someone opens an invalid room:

```text
GET /room/:roomId
```

return a simple `404` page/message.

## Important Scope

Do NOT implement yet:

* WebSockets
* Playback synchronization
* Play/pause synchronization
* Seeking synchronization
* Admin transfer
* Chat
* Database
* Redis
* Authentication
* Multiple admins
* HLS
* Video transcoding

This step is only about establishing the **room + UI foundation**.

The next step will use the existing room structure to synchronize playback between users.

## Documentation

Update the existing documentation under:

```text
/docs
```

Do not create documentation files in the project root other than the existing root README.

Document the new flow:

```text
User → Home → Select Movie → Create Room → /room/:roomId
                                      ↓
                              Other users join
```

## Verification

After implementation, verify:

1. `/` displays uploaded movies.
2. Selecting a movie creates a room.
3. Room IDs are generated server-side.
4. Creator receives an anonymous session ID and becomes admin.
5. Creator is redirected to `/room/:roomId`.
6. Opening the same room URL from another browser shows the same movie/room.
7. The second browser is treated as a viewer.
8. The video is streamed through the existing `/movie/:id` endpoint.
9. Invalid room IDs return 404.
10. Existing Step 1 tests and functionality continue to work.

Keep the implementation simple. **Do not rewrite Step 1.**
