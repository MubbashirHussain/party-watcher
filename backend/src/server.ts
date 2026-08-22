import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { loadEnv } from './config/env.js';
import { movieRoutes } from './routes/movie.route.js';

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

export function buildApp() {
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

  app.register(movieRoutes);

  return { app, env };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app, env } = buildApp();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
