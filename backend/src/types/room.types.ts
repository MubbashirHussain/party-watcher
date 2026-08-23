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
  /** Host playback rate (e.g. 1, 1.5, 2). Viewers match this. */
  speed: number;
}

/** Whether a room is open to anyone or requires a password. */
export type RoomVisibility = 'public' | 'private';

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
  /**
   * Visibility of the room. Private rooms require the correct password
   * before a visitor can view the room or join it.
   */
  visibility: RoomVisibility;
  /** bcrypt hash of the room password (private rooms only; never plaintext). */
  passwordHash?: string;
  /**
   * Opaque access token generated when a private room is created. It is set
   * in an httpOnly `pw_room_<roomId>` cookie after the password is verified,
   * and grants access for the cookie's lifetime.
   */
  accessToken?: string;
  /** Users currently in the room. */
  users: RoomUser[];
  /** Playback state (stored only; synchronization comes later). */
  playback: PlaybackState;
}

/** Shape of `data/current.json`: a map of room ID → room. */
export type RoomStore = Record<string, Room>;
