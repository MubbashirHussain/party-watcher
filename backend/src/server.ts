import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { loadEnv } from './config/env.js';
import { movieRoutes } from './routes/movie.route.js';
import { roomRoutes } from './routes/room.route.js';

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

export async function buildApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      level: 'info',
    },
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error, 'Request error');
    reply.status(500).send({ error: 'Internal server error' });
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(roomRoutes);
  app.register(movieRoutes);

  return { app, env };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app, env } = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
