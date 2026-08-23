# Socket Speed Sync, Live Watch Count & Notifications

## Goal

Extend the room sync WebSocket so that:

1. **Playback speed matches the host, immediately** — when the host changes speed (e.g. 1.5x), viewers switch to the same speed at the same time. The `speed` event carries the host's current `timeline`, so viewers seek to the host's position AND set `playbackRate` in the same instant — no gradual mismatch.
2. **Timeline stays in sync after a few seconds** — the host broadcasts a `drift` timeline every **5s** (was 10s), and viewers correct when they drift more than **1s** (was 2s), so accumulated offset is corrected quickly.
3. **Live watch count** — the UI shows the *connected* viewer count in real time.
4. **Notifications** — viewers see toasts when the host changes speed or quality.

## Key facts learned

- WebSocket hub: `src/services/room-sync.service.ts` (`ws` library, endpoint `/ws`). Host status derived server-side from `userId === room.adminId`; viewer messages are dropped in `handleMessage`.
- Playback persisted via `RoomService.updatePlayback` → `data/current.json`. Room shape in `src/types/room.types.ts` (`PlaybackState { paused, timeline, quality }`). Zod schema in `src/services/room.service.ts` (`playbackSchema`).
- Frontend: `src/views/room.ejs` — `connectSync()`, `sendPlaybackEvent(event)`, `handleSyncMessage(message)`, `setSpeed()` currently only sets `video.playbackRate` locally (never broadcast), `applyPlaybackState(playback)` on `sync`. Drift: host sends `{type:'drift', timeline}` every 10s; viewer corrects only if `|diff| > 2s`, max nudge 5s.
- Viewers currently never see the speed control (menu is `hidden` unless admin) and there's no speed display.
- The "N watching" badge in `topOverlay` is server-rendered from persisted `room.users` and never updates live.
- Tests: `tests/room/room-sync.test.ts` (integration, `ws` client; `connect()` resolves with `sync.playback` — must add `speed` or the `toEqual` assertion breaks).
- Taste: host is source of truth for playback state; never trust client `isAdmin`; don't rewrite working functionality — extend incrementally.

## Changes

### 1. `src/types/room.types.ts`
Add `speed: number` to `PlaybackState`:
```ts
export interface PlaybackState {
  paused: boolean;
  timeline: number;
  quality: string;
  /** Host playback rate (e.g. 1, 1.5, 2). Viewers match this. */
  speed: number;
}
```

### 2. `src/services/room.service.ts`
- Extend `playbackSchema` with `speed: z.number().min(0.25).max(4).default(1)` so existing persisted rooms keep working (default materialized in memory, written back on next persist — same pattern as `visibility`).
- In `createRoom`, add `speed: 1` to the initial playback object.

### 3. `src/services/room-sync.service.ts`
- Extend `PlaybackEvent` union + `playbackEventSchema` with:
  ```ts
  | { type: 'speed'; speed: number; timeline: number }
  ```
  Schema: `z.object({ type: z.literal('speed'), speed: z.number().min(0.25).max(4), timeline: z.number().min(0) })`.
- In `applyPlaybackEvent`, add:
  ```ts
  case 'speed':
    return { ...playback, speed: event.speed, timeline: event.timeline };
  ```
  (persisting the timeline too, so a fresh joiner gets host position + speed).
- Add `private notifyWatchCount(roomId)` that broadcasts `{ type: 'users', count }` (live connected socket count per room) to **every** connection in the room, including the sender (so a just-joined client gets the correct count immediately).
- Call `notifyWatchCount` in `setupClient` (after adding to the set) and in `handleClose` (after removing).

### 3b. Speed lives in playback data AND on the socket

Speed is treated exactly like `quality` — a first-class field of the persisted playback object:

- **Persisted**: `data/current.json` → `room.playback.speed` (Zod `.default(1)` for old rooms).
- **On the socket via `sync`**: the initial `sync` message already sends the full `room.playback`, so it now carries `speed` automatically. A newly joined viewer (or a reload) sets `video.playbackRate = playback.speed` immediately — no extra round-trip needed.
- **On the socket via live events**: when the host changes speed, the `{ type: 'speed', speed, timeline }` event is broadcast so every connected viewer applies the new rate at the host's current position.
- **Same pattern as quality**: `setSpeed` → `sendPlaybackEvent({ type: 'speed', speed, timeline })` → server validates (host-only), persists via `applyPlaybackEvent`, broadcasts. Viewer side applies on `sync` and `speed` events.

### 4. `src/views/room.ejs`
**Speed display + control for everyone:**
- Change the speed menu wrapper from `<div class="relative <%= !isAdmin ? 'hidden' : '' %>">` to always visible — viewers see the current (synced) speed on the button. `toggleSpeedMenu`/`setSpeed` stay host-only (`if (!IS_ADMIN) return;`).
- `setSpeed(rate)` broadcasts the speed **with the host's current timeline**:
  ```js
  function setSpeed(rate) {
      if (!IS_ADMIN) return;
      video.playbackRate = rate;
      document.getElementById('speedBtn').textContent = `${rate}x`;
      document.getElementById('speedMenu').classList.add('hidden');
      sendPlaybackEvent({ type: 'speed', speed: rate, timeline: video.currentTime });
  }
  ```
- `handleSyncMessage` additions:
  ```js
  case 'speed':
      // Apply the new rate AND snap to the host's position at the moment of
      // the change so viewers don't drift apart over time.
      video.playbackRate = message.speed;
      document.getElementById('speedBtn').textContent = `${message.speed}x`;
      if (typeof message.timeline === 'number') {
          applyRemoteSeek(message.timeline);
      }
      if (!IS_ADMIN) showToast(`Host set speed to ${message.speed}x`);
      break;
  case 'quality':
      document.getElementById('currentQuality').textContent = message.quality;
      if (!IS_ADMIN) showToast(`Host set quality to ${message.quality}`);
      break;
  case 'users':
      updateWatchCount(message.count);
      break;
  ```
- `applyPlaybackState(playback)` applies `playback.speed` (set `video.playbackRate` + `speedBtn` label) so fresh joins/reloads match the host's speed too.
- **Tighter drift correction:**
  ```js
  setInterval(() => {
      if (IS_ADMIN && wsConnected && !video.paused) {
          sendPlaybackEvent({ type: 'drift', timeline: video.currentTime });
      }
  }, 5000); // was 10000 — resync timeline every few seconds
  ```
  And in `applyDrift`, lower the threshold:
  ```js
  function applyDrift(timeline) {
      if (video.paused || !video.duration) return;
      const diff = timeline - video.currentTime;
      if (Math.abs(diff) > 1) {           // was 2
          video.currentTime += Math.sign(diff) * Math.min(Math.abs(diff), 5);
      }
  }
  ```
- **Live watch count:** give the "N watching" span an `id="watchCountEl"`; add `updateWatchCount(count)` that sets `watchCountEl.textContent = `${count} watching``.
- **Toast UI:** fixed bottom-left container + `showToast(message)` — vanilla JS + Tailwind classes, auto-dismiss after ~3s.

### 5. Reconnect robustness + API re-sync after reload

A page reload drops the socket, then the client must come back **and** resync state. Plan:

**Client (`room.ejs`):**
- The existing `ws.onclose → setTimeout(connectSync, 2000)` auto-reconnect stays, but harden it:
  - Store the reconnect timer in a `let reconnectTimer` and `clearTimeout(reconnectTimer)` in `ws.onopen` so a reconnect and a timer never double-open sockets.
  - Set a sane `wsConnected` flag only on a real open.
- On **every** `ws.onopen` (initial join AND every reconnect), re-sync authoritative state from the API: `fetch('/room/<ROOM_ID>/state')` → apply `{ playback, watchCount }` (the server always sends a `sync` message too, but the API re-sync guarantees the client converges even if a message was missed while disconnected).
- Fallback: while the socket is down, poll the API every 5s so the client still picks up host state changes and can display the room without a socket.

**Server (`room.route.ts`):**
- New JSON endpoint `GET /room/:roomId/state`:
  - Same access checks as the page render (room exists; private rooms require host / in-room / access cookie).
  - Returns `{ playback: Room['playback'], watchCount: number }` (watchCount = live connected sockets).
- Also refresh `watchCount` from live connections (passed into the route via the `RoomSyncService` or a lightweight counter the service exposes).

**Why reload is safe:** `setupClient` already closes stale sockets from the same userId (code 4001) and sends a fresh `sync` on every connect, so after a reload the client gets the host's speed/timeline/quality via both the socket `sync` AND the API `state` call. The client never loses its identity (same `pw_session` cookie → same userId), so the server still treats it as the same user — no duplicate sessions.

### 6. Join/leave notifications

When someone connects to or disconnects from the room, show a toast to everyone else.

**Server (`room-sync.service.ts`):**
- Track connected socket count **per userId** in the room (derive from `connections` meta): `Map<roomId, Map<userId, number>>`.
- On `setupClient` (after the new socket is added):
  - If the userId's socket count went 0 → 1, this is a real join: broadcast `{ type: 'notification', text: '<name> joined' }` to everyone **except** the new client.
  - Display name from `room.users.find(u => u.id === userId)?.name ?? 'Someone'` (host shows "Host").
- On `handleClose` (after removing):
  - If the userId's socket count went 1 → 0, this is a real leave: broadcast `{ type: 'notification', text: '<name> left' }` to the remaining clients.
- **Reload-safe:** a reload briefly has the old socket still in the set when the new one connects (count 1 → 2), then 2 → 1 on close — neither crosses 0↔1, so no false "joined/left" spam on reload. The `users` count broadcast still fires so the badge stays correct.

**Client (`room.ejs`):**
- `handleSyncMessage` adds `case 'notification': showToast(message.text); break;`.

### 7. `tests/room/room-sync.test.ts`
- `connect()` helper: add `speed: number` to sync shape.
- First test: host sends `{ type: 'speed', speed: 1.5, timeline: 400 }` → viewer receives `speed: 1.5` (+ timeline); extend persisted-state assertion to include `speed: 1.5` and the updated `timeline`.
- "newly joined viewer" test: `toEqual({ paused: true, timeline: 200, quality: '720p', speed: 1 })`.
- New test: **live watch count** — connect host + 2 viewers, expect `users` counts 1 → 2 → 3; after a close, expect decremented count.
- New test: **join/leave notifications** — host connects, viewer connects → host receives `notification` with "joined" (viewer does NOT get it, it's sent to others); viewer closes → host receives "left".
- New test: **reload doesn't spam notifications** — same userId reconnects → no join notification for the old/new pair, but `users` count stays correct.
- New test: **API state endpoint** — `GET /room/:id/state` returns current `playback` (incl. `speed`) and `watchCount`.
- Viewer-sent speed is dropped (extend "ignores viewer commands" test with a viewer `speed` send).

## Verification

1. `npx tsc --noEmit`.
2. `npx vitest run tests/room/room-sync.test.ts`.
3. `npx eslint .` if a lint script exists.
4. Manual smoke:
   - Host changes speed → viewer's video rate + button + toast update instantly and timeline snaps to host's; over a minute of playback drift stays < 1s.
   - New viewer joins → count updates + "joined" toast; tab closes → count drops + "left" toast.
   - Viewer reloads the page → socket reconnects, `sync` + API `state` re-apply speed/timeline, no duplicate connection, no false join/left toasts.
   - Host changes quality → viewer toast.

## Files touched

- `src/types/room.types.ts`
- `src/services/room.service.ts`
- `src/services/room-sync.service.ts`
- `src/services/room-sync.service.ts` (per-user socket counts + notification broadcast)
- `src/routes/room.route.ts` (GET /room/:roomId/state JSON endpoint)
- `src/views/room.ejs` (speed sync, live count, toasts, reconnect hardening + API re-sync)
- `tests/room/room-sync.test.ts`
