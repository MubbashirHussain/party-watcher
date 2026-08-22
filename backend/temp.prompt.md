# Party Watch — UI & Movie Metadata Upgrade

The previous agent task has already been implemented. **Do not rewrite the existing architecture or Step 1/Step 2 functionality.** This is an incremental UI and movie-metadata improvement.

## 1. Movie Metadata

Add:

```text
data/movies.json
```

Use it as the source of movie metadata.

Example:

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

The application should use the `id` from `movies.json` for room/movie selection.

Keep actual video files inside:

```text
uploads/
```

and thumbnails inside the same directory for now.

Do not introduce a database.

Create a small service for reading/validating `movies.json` rather than putting JSON/file-reading logic directly inside EJS routes.

---

# 2. Home Page Redesign

Replace the current basic/debug-style `home.ejs` UI.

The home page should look like a **modern minimal streaming application**.

### Design direction

* Dark UI
* Minimal color palette
* Clean typography
* No gradients
* No excessive rounded cards
* No "premium" visual effects
* No unnecessary animations
* Modern but simple
* Fully responsive
* Mobile-friendly
* Good spacing and hierarchy

The page should contain:

### Header

```text
Party Watch
```

with simple navigation/actions if useful.

### Hero section

Something similar to:

```text
Watch together.

Pick a movie and create a private
watch room for someone special.
```

Keep it compact rather than making a huge landing-page hero.

### Search

Add a simple client-side search field:

```text
Search movies...
```

It should filter the rendered movie cards without requiring another API.

### Movie grid

Display movies as visual cards using their thumbnails.

Example:

```text
┌─────────────────────┐
│                     │
│      thumbnail      │
│                     │
├─────────────────────┤
│ Interstellar        │
│ 2014 · 2h 49m       │
│                     │
│ Create Room →       │
└─────────────────────┘
```

Do NOT display UUIDs as movie names.

The card should use the metadata from `movies.json`:

* title
* year
* duration
* thumbnail

Clicking the card/action should create a room for that movie using the existing room creation flow.

---

# 3. Thumbnail Handling

Add a simple route for movie thumbnails if necessary.

Do not expose arbitrary filesystem paths.

A thumbnail should be associated with the movie metadata and served safely from `/uploads`.

For example:

```text
GET /movie/:id/thumbnail
```

The route must validate the movie ID against `movies.json` before serving the thumbnail.

Do not allow path traversal.

If a thumbnail is missing, show a clean fallback placeholder in the UI instead of breaking the page.

---

# 4. Room Page Redesign

Redesign `room.ejs` to focus primarily on the video.

The video should be the main visual element.

Do not create a large dashboard/sidebar.

Conceptually:

```text
┌──────────────────────────────────────────────┐
│                                              │
│                                              │
│                    VIDEO                     │
│                                              │
│                                              │
│                                              │
└──────────────────────────────────────────────┘
```

The room information should be an **overlay**, not permanently visible.

---

# 5. Room Information Overlay

When the user moves the mouse over the video/room area, show the room information overlay.

The overlay can contain:

* Movie title
* Host/admin status
* Room ID
* Shareable room URL
* Copy button

Example:

```text
Interstellar
Host

Room: abc123

http://localhost:3000/room/abc123    Copy
```

The overlay should naturally fade/hide when the mouse stops moving.

Do not keep the information permanently visible.

For mobile devices, where there is no mouse:

* Tapping the video should reveal the overlay.
* Hide it automatically after a short delay.

Use small vanilla JavaScript for this behavior.

Do not introduce a frontend framework.

---

# 6. Room URL

The shareable URL remains:

```text
/room/:roomId
```

Do not add:

```text
?admin=true
```

or any admin secret to the URL.

The existing anonymous session/cookie system should continue determining whether the current user is the room admin.

The creator remains the initial admin.

---

# 7. Video

Continue using the existing video streaming endpoint:

```text
/movie/:id
```

The room page should consume the video through that endpoint.

Do not expose:

* `/uploads/...`
* absolute filesystem paths
* direct filesystem URLs

to the browser.

Do not change the existing Range-based streaming implementation unless required for integration.

---

# 8. Styling

Keep styling simple.

Prefer a dedicated stylesheet rather than putting a huge `<style>` block inside each EJS file.

For example:

```text
src/
└── public/
    └── css/
        └── app.css
```

Serve static assets through Fastify.

Use vanilla CSS.

Do not introduce Tailwind, Bootstrap, Material UI, or another UI framework.

---

# 9. Empty State

If there are no movies:

Show a proper modern empty state instead of:

```text
No movies found in uploads/
```

Something like:

```text
No movies yet

Add a movie to your library and
it will appear here.
```

Keep it visually consistent with the rest of the application.

---

# 10. Important Constraints

Do NOT implement:

* WebSockets
* Playback synchronization
* Admin controls
* Admin transfer
* Chat
* Database
* Redis
* Authentication
* HLS
* Video transcoding

Those belong to future steps.

This task is only:

```text
Movie metadata
       ↓
Modern movie selection UI
       ↓
Room creation
       ↓
Modern watch-room UI
       ↓
Hover/tap room information overlay
```

---

# 11. Documentation

Update the existing documentation inside:

```text
docs/
```

Document:

* `movies.json`
* Movie metadata structure
* Thumbnail handling
* Home page flow
* Room page flow
* Anonymous admin/session behavior

Do not create additional documentation files unless genuinely necessary.

---

# 12. Verification

After implementation verify:

1. Home page has the new modern UI.
2. Movies are loaded from `data/movies.json`.
3. Movie thumbnails are displayed.
4. Movie title/year/duration are displayed.
5. Search filters movies.
6. Creating a room still works.
7. Room page displays the selected movie.
8. Video still streams through `/movie/:id`.
9. Room information is hidden by default.
10. Room information appears on mouse movement.
11. Room information disappears after inactivity.
12. Mobile tap reveals the overlay.
13. Copy-room-link works.
14. Invalid movie/thumbnail requests are handled safely.
15. Existing tests still pass.
16. TypeScript type checking passes.
17. Production build passes.

Keep the implementation focused and do not modify unrelated functionality.
