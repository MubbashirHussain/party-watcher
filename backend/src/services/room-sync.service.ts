import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';
import type { PlaybackState, Room } from '../types/room.types.js';
import { RoomService } from './room.service.js';
import { roomAccessCookieName, SESSION_COOKIE } from '../utils/session.utils.js';

/** Messages a client may send. Only the host's are honored by the server. */
export type PlaybackEvent =
  | { type: 'play'; timeline: number }
  | { type: 'pause'; timeline: number }
  | { type: 'seek'; timeline: number }
  | { type: 'quality'; quality: string }
  | { type: 'drift'; timeline: number }
  | { type: 'speed'; speed: number; timeline: number };

const playbackEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play'), timeline: z.number().min(0) }),
  z.object({ type: z.literal('pause'), timeline: z.number().min(0) }),
  z.object({ type: z.literal('seek'), timeline: z.number().min(0) }),
  z.object({ type: z.literal('quality'), quality: z.string().min(1).max(20) }),
  z.object({ type: z.literal('drift'), timeline: z.number().min(0) }),
  z.object({
    type: z.literal('speed'),
    speed: z.number().min(0.25).max(4),
    timeline: z.number().min(0),
  }),
]);

const roomIdSchema = z.string().uuid();

interface ConnectionMeta {
  roomId: string;
  userId: string;
  isHost: boolean;
}

/** Parses a Cookie header into a plain map (no cookie library needed). */
function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key !== '') cookies[key] = value;
  }
  return cookies;
}

/** Applies a host event to the room's stored playback state. */
function applyPlaybackEvent(
  playback: PlaybackState,
  event: PlaybackEvent,
): PlaybackState {
  switch (event.type) {
    case 'play':
      return { ...playback, paused: false, timeline: event.timeline };
    case 'pause':
      return { ...playback, paused: true, timeline: event.timeline };
    case 'seek':
      return { ...playback, timeline: event.timeline };
    case 'quality':
      return { ...playback, quality: event.quality };
    case 'drift':
      return { ...playback, timeline: event.timeline };
    case 'speed':
      // Persist the host's timeline too so a fresh joiner gets the position
      // AND speed at the moment of the change.
      return { ...playback, speed: event.speed, timeline: event.timeline };
  }
}

/**
 * WebSocket hub for room playback synchronization.
 *
 * Connections identify themselves with `?roomId=...&userId=...`. The server
 * derives host status from `roomId → userId → isHost` (userId === room.adminId)
 * and never trusts a client-sent `isAdmin` value. Only the host's playback
 * messages are broadcast; viewer messages are dropped.
 *
 * Host playback events are persisted to the room store so a newly connecting
 * client can be sent the current playback state immediately.
 */
export class RoomSyncService {
  private readonly wss: WebSocketServer;
  /** roomId → currently connected WebSockets. */
  private readonly connections = new Map<string, Set<WebSocket>>();
  private readonly meta = new WeakMap<WebSocket, ConnectionMeta>();
  /** roomId → userId → number of open sockets from that user (for join/leave detection). */
  private readonly socketCounts = new Map<string, Map<string, number>>();
  /**
   * roomId → userId → pending "left" timer. A real leave is only announced
   * after `leaveGraceMs` without a reconnect, so a page reload (old socket
   * closes → new page reconnects) never fires "left" + "joined" toasts.
   */
  private readonly pendingLeaves = new Map<string, Map<string, NodeJS.Timeout>>();

  /** How long to wait for a same-user reconnect before announcing a leave. */
  private readonly leaveGraceMs: number;

  /** Number of live WebSocket connections in a room (0 when none). */
  connectionCount(roomId: string): number {
    return this.connections.get(roomId)?.size ?? 0;
  }

  constructor(
    server: HttpServer,
    private readonly rooms: RoomService,
    leaveGraceMs = 5000,
  ) {
    this.leaveGraceMs = leaveGraceMs;
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });
  }

  private handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const url = new URL(request.url ?? '', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const roomId = url.searchParams.get('roomId') ?? '';
    const userId = url.searchParams.get('userId') ?? '';
    if (!roomIdSchema.safeParse(roomId).success || userId === '') {
      this.rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }

    // The userId must match the anonymous session cookie — the server only
    // trusts the cookie identity, never query parameters alone.
    const cookies = parseCookies(request.headers.cookie);
    if (cookies[SESSION_COOKIE] !== userId) {
      this.rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    let room: Room;
    try {
      room = this.rooms.getRoom(roomId);
    } catch {
      this.rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    // Private rooms require the same access as the HTTP routes: the admin
    // (host) and users already in the room are exempt, everyone else needs
    // the room's access-token cookie. The cookie is scoped to /room/:id and
    // is therefore never sent to /ws, so the host/joined users must be
    // exempted here — checking only the cookie would lock everyone out.
    const isHost = userId === room.adminId;
    const userInRoom = room.users.some((user) => user.id === userId);
    if (room.visibility === 'private') {
      const hasAccess =
        isHost ||
        userInRoom ||
        (room.accessToken !== undefined &&
          cookies[roomAccessCookieName(room.id)] === room.accessToken);
      if (!hasAccess) {
        this.rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }
    }

    this.wss.handleUpgrade(request, socket, head, (client) => {
      this.setupClient(client, { roomId, userId, isHost });
    });
  }

  private rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  private setupClient(client: WebSocket, meta: ConnectionMeta): void {
    this.meta.set(client, meta);
    const roomClients = this.connectionsFor(meta.roomId);

    // Replace a stale connection from the same user (e.g. after a reload) so
    // reconnecting never leaves duplicate sockets behind. The stale socket is
    // removed from the room set, its meta dropped (so its late close/error
    // events are ignored by handleClose) and its per-user count decremented
    // SYNCHRONOUSLY here — otherwise the count transiently reads too high
    // (and stays inflated if the close event never fires).
    let replaced = false;
    for (const existing of roomClients) {
      const previous = this.meta.get(existing);
      if (previous && previous.userId === meta.userId && existing !== client) {
        roomClients.delete(existing);
        this.meta.delete(existing);
        this.bumpSocketCount(meta.roomId, meta.userId, -1);
        existing.close(4001, 'Replaced by a newer connection');
        replaced = true;
      }
    }
    roomClients.add(client);

    // A real join is the first socket from this user (0 → 1) with no pending
    // leave and no replaced socket. A reload either replaces a live socket
    // (replaced) or reconnects within the leave grace window (rejoined) —
    // neither fires a false "joined" toast.
    const count = this.bumpSocketCount(meta.roomId, meta.userId, 1);
    const rejoined = this.cancelPendingLeave(meta.roomId, meta.userId);
    if (count === 1 && !rejoined && !replaced) {
      this.sendJoinNotification(meta, client);
    }
    this.notifyWatchCount(meta.roomId);

    client.on('message', (data) => this.handleMessage(client, data));
    client.on('close', () => this.handleClose(client));
    client.on('error', () => this.handleClose(client));

    // Send the current playback state so the new client matches the host.
    // getPlayback extrapolates the timeline to "now" while the room is
    // playing, so a reloader resumes at the live position.
    let playback: PlaybackState;
    try {
      playback = this.rooms.getPlayback(meta.roomId);
    } catch {
      client.close();
      return;
    }
    this.send(client, { type: 'sync', playback });
  }

  /** Increments/decrements a user's open socket count in a room. */
  private bumpSocketCount(
    roomId: string,
    userId: string,
    delta: number,
  ): number {
    let users = this.socketCounts.get(roomId);
    if (!users) {
      users = new Map();
      this.socketCounts.set(roomId, users);
    }
    const next = (users.get(userId) ?? 0) + delta;
    if (next <= 0) {
      users.delete(userId);
      if (users.size === 0) {
        this.socketCounts.delete(roomId);
      }
    } else {
      users.set(userId, next);
    }
    return Math.max(next, 0);
  }

  /** Broadcasts a "X joined"/"X left" toast to everyone except `except`. */
  private sendJoinNotification(meta: ConnectionMeta, except: WebSocket): void {
    const name = this.displayName(meta.roomId, meta.userId);
    this.broadcast(meta.roomId, { type: 'notification', text: `${name} joined` }, except);
  }

  /** Broadcasts a "X left" toast to the remaining clients. */
  private sendLeaveNotification(meta: ConnectionMeta): void {
    const name = this.displayName(meta.roomId, meta.userId);
    this.broadcast(meta.roomId, { type: 'notification', text: `${name} left` }, null);
  }

  /** The user's display name, falling back to "Someone". */
  private displayName(roomId: string, userId: string): string {
    try {
      const room = this.rooms.getRoom(roomId);
      const user = room.users.find((u) => u.id === userId);
      if (user) return user.name;
    } catch {
      // Room gone — fall through to the generic label.
    }
    return 'Someone';
  }

  /** Broadcasts the live connected-socket count to every connection in the room. */
  private notifyWatchCount(roomId: string): void {
    const count = this.connectionCount(roomId);
    const payload = JSON.stringify({ type: 'users', count });
    for (const client of this.connections.get(roomId) ?? []) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private handleMessage(client: WebSocket, data: RawData): void {
    const meta = this.meta.get(client);
    if (!meta) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return; // Malformed messages are ignored.
    }

    const event = playbackEventSchema.safeParse(parsed);
    if (!event.success) return;

    // The host is the only source of truth; viewer commands are dropped.
    if (!meta.isHost) return;

    let room: Room;
    try {
      room = this.rooms.getRoom(meta.roomId);
    } catch {
      return;
    }

    // Persist so a newly joining client receives the current state. A failed
    // write must not interrupt live sync, so the result is not awaited here.
    // updatedAt stamps when the timeline was set, letting the server
    // extrapolate the live position for clients that join or reload while
    // the room is playing.
    const playback = {
      ...applyPlaybackEvent(room.playback, event.data),
      updatedAt: Date.now(),
    };
    void this.rooms.updatePlayback(meta.roomId, playback).catch(() => {});

    this.broadcast(meta.roomId, event.data, client);
  }

  private handleClose(client: WebSocket): void {
    const meta = this.meta.get(client);
    if (!meta) return;
    // Both 'error' and 'close' can fire for a single dead socket, and a
    // socket replaced by a newer connection still emits its own close later —
    // dropping the meta here makes close handling run at most once.
    this.meta.delete(client);
    const roomClients = this.connections.get(meta.roomId);
    if (!roomClients) return;
    roomClients.delete(client);
    if (roomClients.size === 0) {
      this.connections.delete(meta.roomId);
    }

    // A real leave is the user's last open socket (1 → 0). Announce it only
    // after the grace window, so a page reload (same user reconnects within
    // the window) is treated as a reconnect, not a leave + join.
    const remaining = this.bumpSocketCount(meta.roomId, meta.userId, -1);
    if (remaining === 0) {
      this.scheduleLeaveNotification(meta);
    }
    this.notifyWatchCount(meta.roomId);
  }

  /** Schedules a "X left" toast after the grace window (cancelled on reconnect). */
  private scheduleLeaveNotification(meta: ConnectionMeta): void {
    let roomPending = this.pendingLeaves.get(meta.roomId);
    if (!roomPending) {
      roomPending = new Map();
      this.pendingLeaves.set(meta.roomId, roomPending);
    }
    const timer = setTimeout(() => {
      roomPending.delete(meta.userId);
      if (roomPending.size === 0) {
        this.pendingLeaves.delete(meta.roomId);
      }
      this.sendLeaveNotification(meta);
    }, this.leaveGraceMs);
    roomPending.set(meta.userId, timer);
  }

  /** Cancels a pending leave (the user reconnected). Returns true if cancelled. */
  private cancelPendingLeave(roomId: string, userId: string): boolean {
    const roomPending = this.pendingLeaves.get(roomId);
    if (!roomPending) return false;
    const timer = roomPending.get(userId);
    if (!timer) return false;
    clearTimeout(timer);
    roomPending.delete(userId);
    if (roomPending.size === 0) {
      this.pendingLeaves.delete(roomId);
    }
    return true;
  }

  private connectionsFor(roomId: string): Set<WebSocket> {
    let set = this.connections.get(roomId);
    if (!set) {
      set = new Set();
      this.connections.set(roomId, set);
    }
    return set;
  }

  private send(client: WebSocket, message: unknown): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  /** Sends a message to every connection in the room except `except` (null = everyone). */
  private broadcast(
    roomId: string,
    message: unknown,
    except: WebSocket | null,
  ): void {
    const payload = JSON.stringify(message);
    for (const client of this.connections.get(roomId) ?? []) {
      if (client !== except && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /** Closes every client and the WebSocket server. */
  async close(): Promise<void> {
    for (const roomClients of this.connections.values()) {
      for (const client of roomClients) client.close();
    }
    this.connections.clear();
    // Cancel any pending "left" timers so nothing fires after shutdown.
    for (const roomPending of this.pendingLeaves.values()) {
      for (const timer of roomPending.values()) clearTimeout(timer);
    }
    this.pendingLeaves.clear();
    // wss.close() only calls its callback when the server is listening, so
    // resolve unconditionally instead of waiting forever on a callback.
    this.wss.close();
  }
}
