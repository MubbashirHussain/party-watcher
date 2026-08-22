/**
 * A watch room. For Step 2 rooms exist only in memory (no database).
 *
 * Playback state (play/pause, currentTime, seek) is intentionally NOT part of
 * this shape yet — it will be added in a later step when WebSocket
 * synchronization is implemented. Keep this type focused on identity and
 * membership so it can grow without a rewrite.
 */
export interface Room {
  /** Server-generated UUID that appears in the shared URL. */
  id: string;
  /** UUID of the movie being watched (matches `<uploadDir>/<uuid>.mp4`). */
  movieId: string;
  /** Anonymous user ID of the user who created the room. */
  adminUserId: string;
}
