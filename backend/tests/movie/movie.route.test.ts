import { copyFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../../src/config/env.js';
import { buildApp } from '../../src/server.js';
import { generateFixture } from '../fixtures/generate-fixture.js';

// Uploads dir for tests is resolved relative to the package root (where npm test runs).
process.env.UPLOAD_DIR = './uploads';
process.env.PORT = '0';
process.env.MOVIES_FILE = './data/movies.json';

const SLUG = 'interstellar';
const FILENAME = 'interstellar.mp4';

// Fixture size = ftyp box (24) + moov box (16) + mdat box (8 + 2 MiB) = 2097208.
const MOVIE_SIZE = 24 + 16 + 8 + 2 * 1024 * 1024;

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  loadEnv(); // validates env (throws on invalid)
  // Ensure the fixture exists, then copy it to the catalog filename.
  generateFixture();
  await copyFile(
    join(process.cwd(), 'uploads', 'test-movie.mp4'),
    join(process.cwd(), 'uploads', FILENAME),
  );
  // Ensure the catalog thumbnail exists for this movie.
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
    'base64',
  );
  await writeFile(join(process.cwd(), 'uploads', 'interstellar.jpg'), jpeg);

  const built = await buildApp();
  app = built.app;
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine test server address');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
  await rm(join(process.cwd(), 'uploads', FILENAME), { force: true });
});

describe('GET /movie/:id', () => {
  it('streams an existing movie by catalog slug', async () => {
    const res = await fetch(`${baseUrl}/movie/${SLUG}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBe(Number(res.headers.get('content-length')));
    // First bytes are the MP4 ftyp box.
    expect(body.slice(4, 8)).toEqual(new Uint8Array(Buffer.from('ftyp')));
  });

  it('returns 404 for a slug not in the catalog', async () => {
    const res = await fetch(`${baseUrl}/movie/not-in-catalog`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Movie not found' });
  });

  it('returns 400 for an invalid movie ID format', async () => {
    const res = await fetch(`${baseUrl}/movie/..%2F..%2Fsecret`);
    expect(res.status).toBe(400);
  });

  it('returns 206 with range headers for a range request', async () => {
    const res = await fetch(`${baseUrl}/movie/${SLUG}`, {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-1023/${MOVIE_SIZE}`);
    expect(res.headers.get('content-length')).toBe('1024');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(1024);
  });

  it('handles a suffix range (bytes=-1024)', async () => {
    const res = await fetch(`${baseUrl}/movie/${SLUG}`, {
      headers: { Range: 'bytes=-1024' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(
      `bytes ${MOVIE_SIZE - 1024}-${MOVIE_SIZE - 1}/${MOVIE_SIZE}`,
    );
    expect(res.headers.get('content-length')).toBe('1024');
  });

  it('clamps an end beyond file size', async () => {
    const res = await fetch(`${baseUrl}/movie/${SLUG}`, {
      headers: { Range: 'bytes=0-99999999' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(
      `bytes 0-${MOVIE_SIZE - 1}/${MOVIE_SIZE}`,
    );
    expect(res.headers.get('content-length')).toBe(String(MOVIE_SIZE));
  });

  it('returns 416 for an unsatisfiable range', async () => {
    const res = await fetch(`${baseUrl}/movie/${SLUG}`, {
      headers: { Range: 'bytes=99999999-' },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${MOVIE_SIZE}`);
  });

  it('handles an open-ended range (bytes=0-)', async () => {
    const res = await fetch(`${baseUrl}/movie/${SLUG}`, {
      headers: { Range: 'bytes=0-' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(
      `bytes 0-${MOVIE_SIZE - 1}/${MOVIE_SIZE}`,
    );
    expect(res.headers.get('content-length')).toBe(String(MOVIE_SIZE));
  });

  it('returns 416 for an invalid range format', async () => {
    const res = await fetch(`${baseUrl}/movie/${SLUG}`, {
      headers: { Range: 'items=0-1023' },
    });
    expect(res.status).toBe(416);
  });
});

describe('GET /movie/:id/thumbnail', () => {
  it('serves a thumbnail for a catalog movie', async () => {
    const res = await fetch(`${baseUrl}/movie/${SLUG}/thumbnail`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it('returns 404 for a slug not in the catalog', async () => {
    const res = await fetch(`${baseUrl}/movie/not-in-catalog/thumbnail`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid slug', async () => {
    const res = await fetch(`${baseUrl}/movie/..%2F..%2Fsecret/thumbnail`);
    expect(res.status).toBe(400);
  });
});
