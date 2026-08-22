import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { MovieMetadata } from '../types/movie-metadata.types.js';

const movieMetadataSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    year: z.number().int(),
    duration: z.string().min(1),
    thumbnail: z.string().min(1),
    filename: z.string().min(1).endsWith('.mp4'),
  })
  .strict();

const catalogSchema = z.array(movieMetadataSchema);

export class CatalogError extends Error {
  constructor() {
    super('Movie catalog could not be read');
    this.name = 'CatalogError';
  }
}

export class MovieNotInCatalogError extends Error {
  constructor() {
    super('Movie not in catalog');
    this.name = 'MovieNotInCatalogError';
  }
}

/**
 * Reads and validates `data/movies.json` (the single source of movie
 * metadata). Movies are keyed by their slug `id`, and duplicate ids or
 * duplicate filenames are rejected so a slug always maps to one file.
 */
export class MovieCatalogService {
  private readonly moviesBySlug = new Map<string, MovieMetadata>();
  private readonly filenames = new Set<string>();

  async load(moviesFilePath: string): Promise<MovieMetadata[]> {
    let raw: string;
    try {
      raw = await readFile(moviesFilePath, 'utf8');
    } catch {
      throw new CatalogError();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CatalogError();
    }

    const result = catalogSchema.safeParse(parsed);
    if (!result.success) {
      throw new CatalogError();
    }

    const movies = result.data;
    for (const movie of movies) {
      if (this.moviesBySlug.has(movie.id) || this.filenames.has(movie.filename)) {
        throw new CatalogError();
      }
      this.moviesBySlug.set(movie.id, movie);
      this.filenames.add(movie.filename);
    }

    return movies;
  }

  getAll(): MovieMetadata[] {
    return [...this.moviesBySlug.values()];
  }

  getBySlug(slug: string): MovieMetadata {
    const movie = this.moviesBySlug.get(slug);
    if (!movie) {
      throw new MovieNotInCatalogError();
    }
    return movie;
  }

  getByFilename(filename: string): MovieMetadata | undefined {
    for (const movie of this.moviesBySlug.values()) {
      if (movie.filename === filename) {
        return movie;
      }
    }
    return undefined;
  }
}
