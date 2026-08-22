import { randomUUID } from 'node:crypto';
import type { Room } from '../types/room.types.js';

export class RoomNotFoundError extends Error {
  constructor() {
    super('Room not found');
    this.name = 'RoomNotFoundError';
  }
}

/**
 * In-memory room store for Step 2. Rooms live in a Map keyed by UUID and are
 * lost on restart — a database is intentionally out of scope for this step.
 *
 * Room state is the single source of truth for room identity. Playback state
 * will be attached here (or alongside it) when synchronization is implemented.
 */
export class RoomService {
  private readonly rooms = new Map<string, Room>();

  createRoom(movieId: string, adminUserId: string): Room {
    const room: Room = {
      id: randomUUID(),
      movieId,
      adminUserId,
    };
    this.rooms.set(room.id, room);
    return room;
  }

  getRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new RoomNotFoundError();
    }
    return room;
  }
}
