/**
 * A streamable movie file on disk. Step 3 resolves movies through the catalog
 * (`data/movies.json`), so the file is stored as `<uploadDir>/<filename>`
 * where `filename` comes from the movie's metadata.
 */
export interface Movie {
  /** Catalog slug used in the URL (e.g. "interstellar"). */
  id: string;
  /** File name inside the uploads directory (e.g. "interstellar.mp4"). */
  filename: string;
  /** Absolute path to the movie file on disk. */
  filePath: string;
  /** Size of the movie file in bytes. */
  size: number;
}
