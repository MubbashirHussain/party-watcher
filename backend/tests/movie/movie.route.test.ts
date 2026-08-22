import { copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../../src/config/env.js';
import { buildApp } from '../../src/server.js';
import { generateFixture } from '../fixtures/generate-fixture.js';

// Uploads dir for tests is resolved relative to the package root (where npm test runs).
process.env.UPLOAD_DIR = './uploads';
process.env.PORT = '0';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

// Fixture size = ftyp box (24 bytes) + mdat box (8 + 2 MiB) = 2097184.
const MOVIE_SIZE = 24 + 8 + 2 * 1024 * 1024;

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  loadEnv(); // validates env (throws on invalid)
  // Ensure the fixture exists, then copy it to a UUID-named file.
  generateFixture();
  await copyFile(
    join(process.cwd(), 'uploads', 'test-movie.mp4'),
    join(process.cwd(), 'uploads', `${VALID_UUID}.mp4`),
  );
  const built = buildApp();
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
  await rm(join(process.cwd(), 'uploads', `${VALID_UUID}.mp4`), { force: true });
});

describe('GET /movie/:id', () => {
  it('streams an existing movie', async () => {
    const res = await fetch(`${baseUrl}/movie/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBe(Number(res.headers.get('content-length')));
    // First bytes are the MP4 ftyp box.
    expect(body.slice(4, 8)).toEqual(new Uint8Array(Buffer.from('ftyp')));
  });

  it('returns 404 for a missing movie', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const res = await fetch(`${baseUrl}/movie/${missing}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Movie not found' });
  });

  it('returns 400 for an invalid UUID', async () => {
    const res = await fetch(`${baseUrl}/movie/not-a-uuid`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid movie ID' });
  });

  it('returns 400 for a path traversal attempt', async () => {
    const res = await fetch(`${baseUrl}/movie/..%2F..%2Fsecret`);
    expect(res.status).toBe(400);
  });

  it('returns 206 with range headers for a range request', async () => {
    const res = await fetch(`${baseUrl}/movie/${VALID_UUID}`, {
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
    const res = await fetch(`${baseUrl}/movie/${VALID_UUID}`, {
      headers: { Range: 'bytes=-1024' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(
      `bytes ${MOVIE_SIZE - 1024}-${MOVIE_SIZE - 1}/${MOVIE_SIZE}`,
    );
    expect(res.headers.get('content-length')).toBe('1024');
  });

  it('clamps an end beyond file size', async () => {
    const res = await fetch(`${baseUrl}/movie/${VALID_UUID}`, {
      headers: { Range: 'bytes=0-99999999' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(
      `bytes 0-${MOVIE_SIZE - 1}/${MOVIE_SIZE}`,
    );
    expect(res.headers.get('content-length')).toBe(String(MOVIE_SIZE));
  });

  it('returns 416 for an unsatisfiable range', async () => {
    const res = await fetch(`${baseUrl}/movie/${VALID_UUID}`, {
      headers: { Range: 'bytes=99999999-' },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${MOVIE_SIZE}`);
  });

  it('handles an open-ended range (bytes=0-)', async () => {
    const res = await fetch(`${baseUrl}/movie/${VALID_UUID}`, {
      headers: { Range: 'bytes=0-' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(
      `bytes 0-${MOVIE_SIZE - 1}/${MOVIE_SIZE}`,
    );
    expect(res.headers.get('content-length')).toBe(String(MOVIE_SIZE));
  });

  it('returns 416 for an invalid range format', async () => {
    const res = await fetch(`${baseUrl}/movie/${VALID_UUID}`, {
      headers: { Range: 'items=0-1023' },
    });
    expect(res.status).toBe(416);
  });
});
