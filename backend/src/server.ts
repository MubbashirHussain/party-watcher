import "dotenv/config";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import { loadEnv } from "./config/env.js";
import { connectDB, closeDB } from "./db/movies.js";
import { MovieCatalogService } from "./services/movie-catalog.service.js";
import { RoomService } from "./services/room.service.js";
import { RoomSyncService } from "./services/room-sync.service.js";
import { movieRoutes } from "./routes/movie.route.js";
import { roomRoutes } from "./routes/room.route.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

export async function buildApp() {
  const env = loadEnv();

  // Connect to MongoDB before initializing services that use it.
  await connectDB();

  const app = Fastify();

  const catalog = new MovieCatalogService();
  await catalog.load();

  const rooms = new RoomService(env.ROOMS_FILE);
  await rooms.init();

  let sync: RoomSyncService | null = null;

  app.addHook("onListen", () => {
    sync = new RoomSyncService(app.server, rooms);
  });

  app.addHook("onClose", async () => {
    await sync?.close();
    await closeDB();
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error, "Request error");
    reply.status(500).send({ error: "Internal server error" });
  });

  await app.register(fastifyStatic, {
    root: join(moduleDir, "public"),
    prefix: "/static/",
  });

  await app.register(cookie);
  await app.register(formbody);

  await app.register(roomRoutes, {
    catalog,
    rooms,
    getConnectionCount: (roomId) => sync?.connectionCount(roomId) ?? 0,
  });

  app.register(movieRoutes, { catalog });

  return { app, env };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app, env } = await buildApp();

  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0",
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
