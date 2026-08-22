/**
 * A user in a room. Identities are anonymous — a `userId` persisted in a
 * cookie plus an optional display name chosen when joining.
 */
export interface RoomUser {
  /** Unique anonymous user ID (persisted in the pw_session cookie). */
  id: string;
  /** Display name chosen by the user when they join. */
  name: string;
}

/**
 * Playback state for a room. For this step these values are only stored
 * state — synchronization is intentionally NOT implemented yet. A later step
 * will use this shape to sync playback between users.
 */
export interface PlaybackState {
  paused: boolean;
  timeline: number;
  quality: string;
}

/**
 * A watch room, persisted to `data/current.json` (no database).
 */
export interface Room {
  /** Server-generated UUID that appears in the shared URL. */
  id: string;
  /** Movie slug from `data/movies.json`. */
  movieId: string;
  /** Anonymous user ID of the room creator. */
  adminId: string;
  /** Users currently in the room. */
  users: RoomUser[];
  /** Playback state (stored only; synchronization comes later). */
  playback: PlaybackState;
}

/** Shape of `data/current.json`: a map of room ID → room. */
export type RoomStore = Record<string, Room>;
