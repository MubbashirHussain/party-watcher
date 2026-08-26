import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
import type { Room } from "../types/room.types.js";
import {
  getOrCreateUserId,
  hasRoomAccess,
  setRoomAccessCookie,
} from "../utils/session.utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const createRoomBodySchema = z
  .object({
    movieId: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, "Invalid movie ID"),
    visibility: z.enum(["public", "private"]).optional().default("public"),
    password: z.string().min(4).max(72).optional(),
  })
  .superRefine((data, ctx) => {
    // A password is required (and only relevant) for private rooms. The
    // 72-char cap matches bcrypt's hard input limit.
    if (data.visibility === "private" && !data.password) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Private rooms require a password",
      });
    }
  });

const roomParamsSchema = z.object({
  roomId: z.string().uuid(),
});

const joinBodySchema = z.object({
  name: z.string().trim().min(1).max(40),
});

const passwordBodySchema = z.object({
  password: z.string().min(1).max(72),
});

interface RoomViewData {
  roomId: string;
  userId: string;
  movieId: string;
  movieTitle: string;
  movieYear: string | number;
  movieDuration: string;
  roomUrl: string;
  isAdmin: boolean;
  userName: string | null;
  roomUsers: string[];
  roomVisibility: Room["visibility"];
  needsPassword: boolean;
  passwordError: boolean;
}

/**
 * Assembles the data needed to render the room page. Private rooms that the
 * visitor has not unlocked render a lock screen instead of the player.
 */
async function buildRoomViewData(
  request: FastifyRequest,
  reply: FastifyReply,
  catalog: MovieCatalogService,
  rooms: RoomService,
  room: Room,
  passwordError: boolean,
): Promise<RoomViewData> {
  let metadata;
  try {
    metadata = catalog.getBySlug(room.movieId);
  } catch {
    throw new RoomNotFoundError();
  }

  const userId = getOrCreateUserId(request, reply);
  const isAdmin = userId === room.adminId;
  const userInRoom = room.users.find((user) => user.id === userId);
  const needsPassword =
    room.visibility === "private" &&
    !isAdmin &&
    !userInRoom &&
    !hasRoomAccess(request, room.id, room.accessToken);

  return {
    roomId: room.id,
    userId,
    movieId: room.movieId,
    movieTitle: metadata.title,
    movieYear: metadata.year,
    movieDuration: metadata.duration,
    roomUrl: `${request.protocol}://${request.host}/room/${room.id}`,
    isAdmin,
    // The current user's display name (null if they have not joined).
    userName: userInRoom?.name ?? null,
    // Names of other users in the room (excludes the current user).
    roomUsers: room.users
      .filter((user) => user.id !== userId)
      .map((user) => user.name),
    roomVisibility: room.visibility,
    needsPassword,
    passwordError,
  };
}

export async function roomRoutes(
  app: FastifyInstance,
  opts: {
    catalog: MovieCatalogService;
    rooms: RoomService;
    /** Live WebSocket connection count for a room (fallback: persisted users). */
    getConnectionCount?: (roomId: string) => number;
  },
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
      const movies = await catalog.getAll();
      return reply.view("home", { movies });
    },
  );

  app.post<{
    Body: { movieId?: string; visibility?: string; password?: string };
  }>("/rooms", async (request, reply) => {
    const parsed = createRoomBodySchema.safeParse(request.body ?? {});
    console.log("parsed", parsed);

    if (!parsed.success) {
      return reply.status(400).view("error", {
        message:
          "Invalid room settings. Go back and pick a movie (private rooms need a password of 4–72 characters).",
      });
    }
    const { movieId, visibility, password } = parsed.data;

    try {
      await getMovie(catalog, UPLOAD_DIR, movieId);
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
    const room = await rooms.createRoom(movieId, userId, {
      visibility,
      password,
    });
    console.log("Room created: ", room);
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

      const userId = getOrCreateUserId(request, reply);
      // Private rooms must be unlocked before joining. This prevents
      // bypassing the password modal by POSTing straight to /join.
      const userInRoom = room.users.some((user) => user.id === userId);
      const isAdmin = userId === room.adminId;
      if (
        room.visibility === "private" &&
        !isAdmin &&
        !userInRoom &&
        !hasRoomAccess(request, room.id, room.accessToken)
      ) {
        return reply.redirect(`/room/${room.id}`);
      }

      const nameParsed = joinBodySchema.safeParse(request.body ?? {});
      if (!nameParsed.success) {
        return reply.status(400).view("not-found", {
          message: "Please enter your name to join the room.",
        });
      }

      await rooms.addUser(room.id, userId, nameParsed.data.name);
      return reply.redirect(`/room/${room.id}`);
    },
  );

  /**
   * Unlock a private room. A correct password sets the room's access-token
   * cookie; a wrong one redirects back with ?pwError=1 so the lock screen
   * can show a generic error (the password is never echoed back).
   */
  app.post<{ Params: { roomId: string }; Body: { password?: string } }>(
    "/room/:roomId/password",
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

      if (room.visibility !== "private") {
        return reply.redirect(`/room/${room.id}`);
      }

      const passwordParsed = passwordBodySchema.safeParse(request.body ?? {});
      if (!passwordParsed.success) {
        return reply.redirect(`/room/${room.id}?pwError=1`, 303);
      }

      const correct = await rooms.isPasswordCorrect(
        room.id,
        passwordParsed.data.password,
      );
      if (!correct) {
        return reply.redirect(`/room/${room.id}?pwError=1`, 303);
      }

      const accessToken = await rooms.ensureAccessToken(room.id);
      setRoomAccessCookie(reply, room.id, accessToken);
      return reply.redirect(`/room/${room.id}`, 303);
    },
  );

  app.get<{ Params: { roomId: string }; Querystring: { pwError?: string } }>(
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

      const data = await buildRoomViewData(
        request,
        reply,
        catalog,
        rooms,
        room,
        request.query.pwError === "1",
      );
      return reply.view("room", data);
    },
  );

  /**
   * JSON snapshot used by the client to re-sync after a socket reconnect or
   * reload. Returns the room's current playback state (including speed) plus
   * the live connected-socket count. Access rules mirror the page render.
   */
  app.get<{ Params: { roomId: string } }>(
    "/room/:roomId/state",
    async (request, reply) => {
      const parsed = roomParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(404).send({ error: "Invalid room link." });
      }

      let room;
      try {
        room = rooms.getRoom(parsed.data.roomId);
      } catch (err) {
        if (err instanceof RoomNotFoundError) {
          return reply.status(404).send({ error: "Room not found." });
        }
        throw err;
      }

      const userId = getOrCreateUserId(request, reply);
      const isAdmin = userId === room.adminId;
      const userInRoom = room.users.some((user) => user.id === userId);
      if (
        room.visibility === "private" &&
        !isAdmin &&
        !userInRoom &&
        !hasRoomAccess(request, room.id, room.accessToken)
      ) {
        return reply.status(403).send({ error: "Forbidden." });
      }

      return reply.send({
        // getPlayback extrapolates the timeline to "now" while the room is
        // playing, so a reloaded client resumes at the live position.
        playback: rooms.getPlayback(room.id),
        watchCount: opts.getConnectionCount?.(room.id) ?? room.users.length,
      });
    },
  );
}
