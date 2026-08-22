import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createFileStream, getFileSize, resolveFilePath } from '../utils/file.utils.js';
import { getMovie, MovieNotFoundError } from '../services/movie.service.js';
import {
  MovieNotInCatalogError,
  type MovieCatalogService,
} from '../services/movie-catalog.service.js';
import type { MovieMetadata } from '../types/movie-metadata.types.js';
import { loadEnv } from '../config/env.js';

const movieParamsSchema = z.object({
  // Movie IDs are catalog slugs (e.g. "interstellar"), not filesystem paths.
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Invalid movie ID'),
});

const CHUNK_SIZE = 1024 * 1024; // 1 MiB
const DEFAULT_RANGE_END = CHUNK_SIZE - 1;

export async function movieRoutes(
  app: FastifyInstance,
  opts: { catalog: MovieCatalogService },
): Promise<void> {
  const { UPLOAD_DIR } = loadEnv();
  const { catalog } = opts;

  app.get<{ Params: { id: string } }>('/movie/:id/thumbnail', async (request, reply) => {
    const parsed = movieParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid movie ID' });
    }

    let metadata: MovieMetadata;
    try {
      metadata = catalog.getBySlug(parsed.data.id);
    } catch (err) {
      if (err instanceof MovieNotInCatalogError) {
        return reply.code(404).send({ error: 'Movie not found' });
      }
      throw err;
    }

    const thumbnailPath = resolveFilePath(UPLOAD_DIR, metadata.thumbnail);
    try {
      const stats = await getFileSize(thumbnailPath);
      return reply
        .header('Content-Type', 'image/jpeg')
        .header('Content-Length', stats)
        .send(createFileStream(thumbnailPath));
    } catch {
      return reply.code(404).send({ error: 'Thumbnail not found' });
    }
  });

  app.get<{ Params: { id: string } }>('/movie/:id', async (request, reply) => {
    const parsed = movieParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid movie ID' });
    }
    const { id } = parsed.data;

    let movie;
    try {
      movie = await getMovie(catalog, UPLOAD_DIR, id);
    } catch (err) {
      if (err instanceof MovieNotFoundError || err instanceof MovieNotInCatalogError) {
        request.log.info({ movieId: id }, 'Movie not found');
        return reply.code(404).send({ error: 'Movie not found' });
      }
      throw err;
    }

    const range = request.headers.range;

    // Without a Range header, stream the whole file (200 OK).
    if (!range) {
      reply
        .header('Accept-Ranges', 'bytes')
        .header('Content-Type', 'video/mp4')
        .header('Content-Length', movie.size);
      return reply.send(createFileStream(movie.filePath));
    }

    // With a Range header, serve a 206 Partial Content response.
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return reply
        .code(416)
        .header('Content-Range', `bytes */${movie.size}`)
        .send({ error: 'Invalid range' });
    }

    const startStr = match[1] ?? '';
    const endStr = match[2] ?? '';

    let start: number;
    let end: number;

    if (startStr === '' && endStr === '') {
      return reply
        .code(416)
        .header('Content-Range', `bytes */${movie.size}`)
        .send({ error: 'Invalid range' });
    }

    if (startStr === '') {
      // Suffix range: last N bytes.
      const suffixLength = Number(endStr);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        return reply
          .code(416)
          .header('Content-Range', `bytes */${movie.size}`)
          .send({ error: 'Invalid range' });
      }
      start = Math.max(0, movie.size - suffixLength);
      end = movie.size - 1;
    } else {
      start = Number(startStr);
      if (!Number.isSafeInteger(start) || start < 0 || start >= movie.size) {
        return reply
          .code(416)
          .header('Content-Range', `bytes */${movie.size}`)
          .send({ error: 'Invalid range' });
      }
      if (endStr === '') {
        end = movie.size - 1;
      } else {
        end = Number(endStr);
        if (!Number.isSafeInteger(end)) {
          return reply
            .code(416)
            .header('Content-Range', `bytes */${movie.size}`)
            .send({ error: 'Invalid range' });
        }
        end = Math.min(end, movie.size - 1);
        if (end < start) {
          return reply
            .code(416)
            .header('Content-Range', `bytes */${movie.size}`)
            .send({ error: 'Invalid range' });
        }
      }
    }

    const length = end - start + 1;
    reply
      .code(206)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', 'video/mp4')
      .header('Content-Length', length)
      .header('Content-Range', `bytes ${start}-${end}/${movie.size}`);

    return reply.send(createFileStream(movie.filePath, start, end));
  });
}