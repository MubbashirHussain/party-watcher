import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../utils/password.utils.js';
import type { Room, RoomStore, RoomVisibility } from '../types/room.types.js';

export class RoomNotFoundError extends Error {
  constructor() {
    super('Room not found');
    this.name = 'RoomNotFoundError';
  }
}

export class RoomStoreError extends Error {
  constructor() {
    super('Room store could not be read');
    this.name = 'RoomStoreError';
  }
}

export class RoomPasswordRequiredError extends Error {
  constructor() {
    super('Private rooms require a password');
    this.name = 'RoomPasswordRequiredError';
  }
}

const roomUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const playbackSchema = z.object({
  paused: z.boolean(),
  timeline: z.number(),
  quality: z.string(),
});

const roomSchema = z.object({
  id: z.string().min(1),
  movieId: z.string().min(1),
  adminId: z.string().min(1),
  // Rooms created before visibility existed default to public so existing
  // rooms keep working. The default is materialized in memory and written
  // back on the next persist().
  visibility: z.enum(['public', 'private']).default('public'),
  passwordHash: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
  users: z.array(roomUserSchema),
  playback: playbackSchema,
});

const roomStoreSchema = z.record(z.string(), roomSchema);

/** Options controlling the created room's visibility. */
export interface CreateRoomOptions {
  visibility?: RoomVisibility;
  /** Plaintext password; required when visibility is 'private'. */
  password?: string;
}

/**
 * File-backed room store persisted to `data/current.json`.
 *
 * Rooms live in a plain object keyed by room ID. Every mutation is applied
 * to the in-memory snapshot first and then written to disk. Writes are
 * chained on a single promise so concurrent requests cannot interleave file
 * writes (safe enough for this MVP).
 */
export class RoomService {
  private rooms: RoomStore = {};
  private writeChain: Promise<void> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Loads existing rooms from disk (missing file starts empty). */
  async init(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      this.rooms = {};
      return;
    }

    const parsed: unknown = JSON.parse(raw);
    const result = roomStoreSchema.safeParse(parsed);
    if (!result.success) {
      throw new RoomStoreError();
    }
    this.rooms = result.data;
  }

  /**
   * Creates a room and persists it. Returns the created room.
   * Private rooms are hashed with bcrypt and given a unique access token
   * (never stored as plaintext).
   */
  async createRoom(
    movieId: string,
    adminId: string,
    options: CreateRoomOptions = {},
  ): Promise<Room> {
    const visibility = options.visibility ?? 'public';
    if (visibility === 'private' && !options.password) {
      throw new RoomPasswordRequiredError();
    }

    const room: Room = {
      id: randomUUID(),
      movieId,
      adminId,
      visibility,
      users: [{ id: adminId, name: 'Host' }],
      playback: { paused: false, timeline: 0, quality: '720p' },
    };
    if (visibility === 'private') {
      room.passwordHash = await hashPassword(options.password!);
      room.accessToken = randomUUID();
    }
    this.rooms[room.id] = room;
    await this.persist();
    return room;
  }

  /** Returns a room or throws RoomNotFoundError. */
  getRoom(roomId: string): Room {
    const room = this.rooms[roomId];
    if (!room) {
      throw new RoomNotFoundError();
    }
    return room;
  }

  /** Returns whether the user is already in the room. */
  isUserInRoom(roomId: string, userId: string): boolean {
    const room = this.getRoom(roomId);
    return room.users.some((user) => user.id === userId);
  }

  /**
   * Verifies a plaintext password against the room's bcrypt hash.
   * Always returns false for public rooms or rooms without a hash.
   */
  async isPasswordCorrect(roomId: string, password: string): Promise<boolean> {
    const room = this.getRoom(roomId);
    if (room.visibility !== 'private') {
      return false;
    }
    return verifyPassword(password, room.passwordHash);
  }

  /**
   * Makes sure a private room has an access token (creating and persisting
   * one if it was missing, e.g. from a hand-edited store file).
   */
  async ensureAccessToken(roomId: string): Promise<string> {
    const room = this.getRoom(roomId);
    if (!room.accessToken) {
      room.accessToken = randomUUID();
      await this.persist();
    }
    return room.accessToken;
  }

  /**
   * Adds (or renames) a user in the room and persists. Returns the room.
   * If the user is already present, their name is updated instead of adding
   * a duplicate.
   */
  async addUser(roomId: string, userId: string, name: string): Promise<Room> {
    const room = this.getRoom(roomId);
    const existing = room.users.find((user) => user.id === userId);
    if (existing) {
      existing.name = name;
    } else {
      room.users.push({ id: userId, name });
    }
    await this.persist();
    return room;
  }

  /** Rewrites the store file atomically. */
  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.rooms, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, snapshot, 'utf8');
    });
    await this.writeChain;
  }
}
