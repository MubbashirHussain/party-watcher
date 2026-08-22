import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import view from '@fastify/view';
import ejs from 'ejs';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { getMovie, MovieNotFoundError } from '../services/movie.service.js';
import { listMovies, RoomNotFoundError, RoomService } from '../services/room.service.js';
import { getOrCreateUserId } from '../utils/session.utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const createRoomBodySchema = z.object({
  movieId: z.string().uuid(),
});

const roomParamsSchema = z.object({
  roomId: z.string().uuid(),
});

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  const { UPLOAD_DIR } = loadEnv();
  const rooms = new RoomService();

  app.register(view, {
    engine: { ejs },
    root: join(__dirname, '..', 'views'),
  });

  app.get<{ Querystring: { movieId?: string } }>('/', async (request, reply) => {
    let movies: string[];
    try {
      movies = await listMovies(UPLOAD_DIR);
    } catch (err) {
      request.log.error(err, 'Failed to list movies');
      return reply.status(500).view('error', {
        message: 'Could not load the movie list.',
      });
    }
    return reply.view('home', { movies });
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
      await getMovie(UPLOAD_DIR, movieId);
    } catch (err) {
      if (err instanceof MovieNotFoundError) {
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

    const userId = getOrCreateUserId(request, reply);
    const isAdmin = userId === room.adminUserId;
    const roomUrl = `${request.protocol}://${request.host}/room/${room.id}`;

    return reply.view('room', {
      roomId: room.id,
      movieId: room.movieId,
      roomUrl,
      isAdmin,
    });
  });
}
