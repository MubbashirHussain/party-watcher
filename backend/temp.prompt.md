# Step 3 — Room State & User Identity

Fix the current room flow. Keep this implementation simple and in-memory/file-based. Do not introduce a database, WebSocket, or authentication yet.

## Flow

```text
GET /
  ↓
Show movies
  ↓
User clicks a movie
  ↓
Create room
  ↓
Redirect to /room/:roomId
```

Example:

```text
http://localhost:3000/room/18393267846823789
```

## Room State

Create:

```text
data/current.json
```

This file should contain the current active rooms.

Use a clean structure similar to:

```json
{
  "18393267846823789": {
    "movieId": "67623782392",
    "adminId": "user-uuid",
    "users": [
      {
        "id": "user-uuid",
        "name": "Alex"
      }
    ],
    "playback": {
      "paused": false,
      "timeline": 0,
      "quality": "720p"
    }
  }
}
```

You may improve the exact key names/types if needed, but keep the structure simple.

## Room Creation

When a user selects a movie:

1. Generate a unique room ID.
2. Generate a unique anonymous `userId`.
3. Store the `userId` in a cookie.
4. Create the room in `data/current.json`.
5. Set the creator as `adminId`.
6. Add the creator to `users`.
7. Redirect to `/room/:roomId`.

The room URL must only contain the room ID:

```text
/room/:roomId
```

Do not put the user ID or admin information in the URL.

## Joining an Existing Room

When another user opens:

```text
/room/18393267846823789
```

the server should:

1. Check the user's `userId` cookie.
2. If the user already belongs to the room, continue normally.
3. If this is a new user, show a **name modal** before entering the room.

The modal should ask:

```text
What's your name?

[ Enter your name ]

[ Join Room ]
```

After submitting:

* Save the name against the user's `userId`.
* Add the user to the room's `users` list.
* Continue displaying the room.

Do not require authentication.

## Important User Identity Rule

Every visitor must have a unique anonymous `userId`.

Use a cookie to persist it.

Do not identify users by IP address. Multiple people can share the same IP, and the same person can change IPs.

## Room State

The room should initially contain:

```text
movieId
adminId
users
playback.paused
playback.timeline
playback.quality
```

For now, these playback values are only state.

**Do not implement synchronization yet.**

The next step will use this state to synchronize playback between users.

## Existing UI

Keep the existing modern movie grid and room UI.

Only change the flow/state management necessary for this step.

The room page should now be able to display:

* Movie
* Current user's name
* Admin status
* Room users
* Room ID/share URL

Keep the room information overlay behavior from the previous step.

## Persistence

For this MVP, `data/current.json` is sufficient.

Create safe helper/service functions for:

* Creating a room
* Finding a room
* Updating a room
* Adding a user
* Reading/writing `current.json`

Do not add a database or Redis.

Handle concurrent file writes safely enough for this small MVP.

## Verification

Test this exact flow:

```text
Browser A
GET /
→ select movie
→ room created
→ Browser A becomes admin

Browser A
→ /room/ROOM_ID
→ sees room

Browser B
→ opens same /room/ROOM_ID
→ name modal appears
→ enters name
→ joins room

current.json
→ contains the room
→ contains adminId
→ contains both users
→ contains playback state
```

Keep this implementation short, clean, and focused. Do not implement future synchronization functionality yet
.