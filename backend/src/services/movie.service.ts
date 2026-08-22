import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveFilePath } from '../utils/file.utils.js';
import type { Movie } from '../types/movie.types.js';
import type { MovieCatalogService } from './movie-catalog.service.js';

export class MovieNotFoundError extends Error {
  constructor() {
    super('Movie not found');
    this.name = 'MovieNotFoundError';
  }
}

export class MoviePathError extends Error {
  constructor() {
    super('Invalid movie path');
    this.name = 'MoviePathError';
  }
}

export async function getMovie(
  catalog: MovieCatalogService,
  uploadDir: string,
  slug: string,
): Promise<Movie> {
  const metadata = catalog.getBySlug(slug);
  const filePath = resolveFilePath(uploadDir, metadata.filename);

  // Guard against a symlink inside uploads pointing outside the directory.
  const resolved = resolve(filePath);
  const resolvedUploadDir = resolve(uploadDir);
  if (!resolved.startsWith(resolvedUploadDir + '/')) {
    throw new MoviePathError();
  }

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      throw new MovieNotFoundError();
    }
    return {
      id: metadata.id,
      filename: metadata.filename,
      filePath,
      size: Number(stats.size),
    };
  } catch (err) {
    if (err instanceof MovieNotFoundError || err instanceof MoviePathError) {
      throw err;
    }
    throw new MovieNotFoundError();
  }
}
