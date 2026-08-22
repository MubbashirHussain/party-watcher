/**
 * A movie is identified by a UUID. For Step 1, the file is stored on disk as
 * `<uploadDir>/<uuid>.mp4`. No other metadata exists yet.
 */
export interface Movie {
  /** UUID used in the URL and as the file name stem. */
  id: string;
  /** Absolute path to the movie file on disk. */
  filePath: string;
  /** Size of the movie file in bytes. */
  size: number;
}
