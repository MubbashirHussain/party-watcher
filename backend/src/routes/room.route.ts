import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import view from '@fastify/view';
import ejs from 'ejs';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { getMovie, MovieNotFoundError } from '../services/movie.service.js';
import {
  MovieNotInCatalogError,
  type MovieCatalogService,
} from '../services/movie-catalog.service.js';
import { RoomNotFoundError, RoomService } from '../services/room.service.js';
import { getOrCreateUserId } from '../utils/session.utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const createRoomBodySchema = z.object({
  movieId: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Invalid movie ID'),
});

const roomParamsSchema = z.object({
  roomId: z.string().uuid(),
});

export async function roomRoutes(
  app: FastifyInstance,
  opts: { catalog: MovieCatalogService },
): Promise<void> {
  const { UPLOAD_DIR } = loadEnv();
  const rooms = new RoomService();
  const { catalog } = opts;

  app.register(view, {
    engine: { ejs },
    root: join(__dirname, '..', 'views'),
  });

  app.get<{ Querystring: { movieId?: string } }>('/', async (request, reply) => {
    return reply.view('home', { movies: catalog.getAll() });
  });

  app.post<{ Body: { movieId?: string } }>('/rooms', async (request, reply) => {
    const parsed = createRoomBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).view('error', {
        message: 'Invalid movie selection. Go back and pick a movie.',
      });
    }
    const { movieId } = parsed.data;

    try {
      await getMovie(catalog, UPLOAD_DIR, movieId);
    } catch (err) {
      if (err instanceof MovieNotFoundError || err instanceof MovieNotInCatalogError) {
        return reply.status(404).view('not-found', {
          message: 'That movie does not exist.',
        });
      }
      throw err;
    }

    const userId = getOrCreateUserId(request, reply);
    const room = rooms.createRoom(movieId, userId);
    return reply.redirect(`/room/${room.id}`);
  });

  app.get<{ Params: { roomId: string } }>('/room/:roomId', async (request, reply) => {
    const parsed = roomParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(404).view('not-found', {
        message: 'Invalid room link.',
      });
    }

    let room;
    try {
      room = rooms.getRoom(parsed.data.roomId);
    } catch (err) {
      if (err instanceof RoomNotFoundError) {
        return reply.status(404).view('not-found', {
          message: 'Room not found. It may have expired or the link is wrong.',
        });
      }
      throw err;
    }

    let metadata;
    try {
      metadata = catalog.getBySlug(room.movieId);
    } catch {
      return reply.status(404).view('not-found', {
        message: 'The movie for this room is no longer available.',
      });
    }

    const userId = getOrCreateUserId(request, reply);
    const isAdmin = userId === room.adminUserId;
    const roomUrl = `${request.protocol}://${request.host}/room/${room.id}`;

    return reply.view('room', {
      roomId: room.id,
      movieId: room.movieId,
      movieTitle: metadata.title,
      movieYear: metadata.year,
      movieDuration: metadata.duration,
      thumbnailUrl: `/movie/${room.movieId}/thumbnail`,
      roomUrl,
      isAdmin,
    });
  });
}
