# Step 4 — Host & Viewer Playback Synchronization

Implement real-time playback synchronization using **WebSocket (`ws`)**.

Keep the existing architecture and functionality. Do not rewrite unrelated code.

## Core Rule

The **host is the source of truth**.

```text
Host
 ↓
WebSocket
 ↓
All viewers
```

Viewers must not control playback.

## Synchronize

Synchronize these states:

```text
- play
- pause
- seek/timeline
- quality
- current playback state when joining
```

Use the existing room state in `data/current.json`.

Example:

```json
{
  "playback": {
    "paused": false,
    "timeline": 120.5,
    "quality": "720p"
  }
}
```

## WebSocket

Create a WebSocket connection when the room page loads.

Identify the connection using:

```text
roomId
userId
```

The server must determine whether the user is the host.

Do not trust an `isAdmin` value sent by the client.

## Host Actions

When the host:

### Plays

Broadcast:

```json
{
  "type": "play",
  "timeline": 120.5
}
```

### Pauses

Broadcast:

```json
{
  "type": "pause",
  "timeline": 120.5
}
```

### Seeks

Broadcast:

```json
{
  "type": "seek",
  "timeline": 350.2
}
```

### Changes quality

Broadcast:

```json
{
  "type": "quality",
  "quality": "720p"
}
```

Also update `data/current.json`.

## Viewer Behavior

When a viewer receives:

```text
play
```

play the video at the supplied timeline.

When receiving:

```text
pause
```

pause at the supplied timeline.

When receiving:

```text
seek
```

move the video to that timeline.

When receiving:

```text
quality
```

update the selected quality/UI state.

Viewers must not send playback control events to other users.

If a viewer tries to control playback, ignore/reject the action server-side.

## New User

When a user joins an existing room:

```text
Browser
 ↓
WebSocket connection
 ↓
Server reads current room state
 ↓
Send current playback state
 ↓
Browser applies it
```

The new viewer should immediately match the host's current:

* timeline
* play/pause state
* quality

## Timeline Updates

Do NOT send a WebSocket message on every `timeupdate` event.

Avoid continuous high-frequency synchronization.

Send updates when:

* Host seeks
* Host plays
* Host pauses
* Host changes quality

Optionally send a lightweight periodic synchronization message if needed to correct playback drift.

## Reconnection

If a viewer disconnects:

* Remove/mark the WebSocket connection as disconnected.
* Allow them to reconnect using the same `userId`.

Do not create duplicate users.

If the host temporarily disconnects, do not automatically transfer admin yet.

## Security

The server must always determine:

```text
roomId → userId → isHost
```

Never trust:

```text
isAdmin: true
```

from the browser.

A viewer must not be able to send host-only playback commands by modifying WebSocket messages.

## UI

Use the existing custom video player.

Host:

```text
Play
Pause
Seek
Quality
```

Viewers:

```text
Playback controls disabled/hidden
```

Viewers should still see the current timeline and video state.

## Important

Do NOT implement:

* Admin transfer
* Chat
* Voice/video calls
* Database
* Redis
* HLS
* Complex drift correction
* Multi-host support

Keep the implementation simple.

## Verification

Test with two browser windows:

```text
Browser A
→ creates room
→ becomes host

Browser B
→ joins room
→ becomes viewer
```

Verify:

```text
Host plays
→ Viewer plays

Host pauses
→ Viewer pauses

Host seeks
→ Viewer seeks

Host changes quality
→ Viewer receives change

Viewer joins
→ Viewer receives current playback state
```

Existing room creation, public/private rooms, user identity, movie streaming, and UI must continue working.
