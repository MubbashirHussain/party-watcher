import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import view from "@fastify/view";
import ejs from "ejs";
import { z } from "zod";
import { loadEnv } from "../config/env.js";
import { getMovie, MovieNotFoundError } from "../services/movie.service.js";
import {
  MovieNotInCatalogError,
  type MovieCatalogService,
} from "../services/movie-catalog.service.js";
import { RoomNotFoundError, RoomService } from "../services/room.service.js";
import { getOrCreateUserId } from "../utils/session.utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const createRoomBodySchema = z.object({
  movieId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Invalid movie ID"),
});

const roomParamsSchema = z.object({
  roomId: z.string().uuid(),
});

const joinBodySchema = z.object({
  name: z.string().trim().min(1).max(40),
});

export async function roomRoutes(
  app: FastifyInstance,
  opts: { catalog: MovieCatalogService; rooms: RoomService },
): Promise<void> {
  const { UPLOAD_DIR } = loadEnv();
  const { catalog, rooms } = opts;

  app.register(view, {
    engine: { ejs },
    root: join(__dirname, "..", "views"),
  });

  app.get<{ Querystring: { movieId?: string } }>(
    "/",
    async (request, reply) => {
      return reply.view("home", { movies: catalog.getAll() });
    },
  );

  app.post<{ Body: { movieId?: string } }>("/rooms", async (request, reply) => {
    const parsed = createRoomBodySchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).view("error", {
        message: "Invalid movie selection. Go back and pick a movie.",
      });
    }
    const { movieId } = parsed.data;
    console.log(
      "------------------------------------",
      catalog,
      UPLOAD_DIR,
      movieId,
    );

    try {
      const movie = await getMovie(catalog, UPLOAD_DIR, movieId);
      // console.log("MOVIE FOUND", movie.path);
    } catch (err) {
      if (
        err instanceof MovieNotFoundError ||
        err instanceof MovieNotInCatalogError
      ) {
        return reply.status(404).view("not-found", {
          message: "That movie does not exist.",
        });
      }
      throw err;
    }

    const userId = getOrCreateUserId(request, reply);
    const room = await rooms.createRoom(movieId, userId);
    return reply.redirect(`/room/${room.id}`);
  });

  /**
   * Join a room with a display name. The name is stored against the user's
   * anonymous ID and the user is added to the room's users list.
   */
  app.post<{ Params: { roomId: string }; Body: { name?: string } }>(
    "/room/:roomId/join",
    async (request, reply) => {
      const roomParsed = roomParamsSchema.safeParse(request.params);
      if (!roomParsed.success) {
        return reply.status(404).view("not-found", {
          message: "Invalid room link.",
        });
      }

      let room;
      try {
        room = rooms.getRoom(roomParsed.data.roomId);
      } catch (err) {
        if (err instanceof RoomNotFoundError) {
          return reply.status(404).view("not-found", {
            message:
              "Room not found. It may have expired or the link is wrong.",
          });
        }
        throw err;
      }

      const nameParsed = joinBodySchema.safeParse(request.body ?? {});
      if (!nameParsed.success) {
        return reply.status(400).view("not-found", {
          message: "Please enter your name to join the room.",
        });
      }

      const userId = getOrCreateUserId(request, reply);
      await rooms.addUser(room.id, userId, nameParsed.data.name);
      return reply.redirect(`/room/${room.id}`);
    },
  );

  app.get<{ Params: { roomId: string } }>(
    "/room/:roomId",
    async (request, reply) => {
      const parsed = roomParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(404).view("not-found", {
          message: "Invalid room link.",
        });
      }

      let room;
      try {
        room = rooms.getRoom(parsed.data.roomId);
      } catch (err) {
        if (err instanceof RoomNotFoundError) {
          return reply.status(404).view("not-found", {
            message:
              "Room not found. It may have expired or the link is wrong.",
          });
        }
        throw err;
      }

      let metadata;
      try {
        metadata = catalog.getBySlug(room.movieId);
      } catch {
        return reply.status(404).view("not-found", {
          message: "The movie for this room is no longer available.",
        });
      }

      const userId = getOrCreateUserId(request, reply);
      const isAdmin = userId === room.adminId;
      const userInRoom = room.users.find((user) => user.id === userId);
      const roomUrl = `${request.protocol}://${request.host}/room/${room.id}`;

      return reply.view("room", {
        roomId: room.id,
        movieId: room.movieId,
        movieTitle: metadata.title,
        movieYear: metadata.year,
        movieDuration: metadata.duration,
        roomUrl,
        isAdmin,
        // The current user's display name (null if they have not joined).
        userName: userInRoom?.name ?? null,
        // Names of other users in the room (excludes the current user).
        roomUsers: room.users
          .filter((user) => user.id !== userId)
          .map((user) => user.name),
      });
    },
  );
}
