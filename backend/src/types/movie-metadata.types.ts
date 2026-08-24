/**
 * A movie as described by the metadata catalog (`data/movies.json`).
 *
 * `id` is a human-friendly slug used everywhere the app refers to a movie
 * (URLs, room creation). `filename` points at the actual MP4 inside
 * `uploads/`; `thumbnail` is an image file inside `uploads/` too.
 */
export interface MovieMetadata {
  /** Slug used in URLs and room creation, e.g. "interstellar". */
  id: string;
  /** Display title, e.g. "Interstellar". */
  title: string;
  /** Release year, e.g. 2014. */
  year: number;
  /** Human-readable runtime, e.g. "2h 49m". */
  duration: string;
  /** Thumbnail file name inside uploads/, e.g. "interstellar.jpg". */
  thumbnail: string;
  /** MP4 file name inside uploads/, e.g. "interstellar.mp4". */
  filename: string;
  /** Genre of the movie, e.g. "Sci-fi". */
  genre?: string;
}
