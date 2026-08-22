import { copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../../src/config/env.js';
import { buildApp } from '../../src/server.js';
import { generateFixture } from '../fixtures/generate-fixture.js';

process.env.UPLOAD_DIR = './uploads';
process.env.PORT = '0';

const VALID_UUID = '0e00beef-0000-4000-8000-000000000001';

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  loadEnv();
  generateFixture();
  await copyFile(
    join(process.cwd(), 'uploads', 'test-movie.mp4'),
    join(process.cwd(), 'uploads', `${VALID_UUID}.mp4`),
  );
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
  await rm(join(process.cwd(), 'uploads', `${VALID_UUID}.mp4`), { force: true });
});

describe('GET /', () => {
  it('renders the movie list page', async () => {
    const res = await fetch(baseUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Party Watch');
    // The uploaded fixture should be listed by its UUID.
    expect(html).toContain(VALID_UUID);
  });
});

describe('POST /rooms', () => {
  it('creates a room, sets a session cookie, and redirects to /room/:roomId', async () => {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ movieId: VALID_UUID }),
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/^\/room\/[0-9a-f-]{36}$/);

    // The creator gets an anonymous session cookie.
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toMatch(/^pw_session=[0-9a-f-]{36};/);
  });

  it('rejects a movie that does not exist', async () => {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        movieId: '00000000-0000-4000-8000-000000000000',
      }),
      redirect: 'manual',
    });
    expect(res.status).toBe(404);
  });

  it('rejects a non-UUID movie ID', async () => {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ movieId: 'not-a-uuid' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /room/:roomId', () => {
  async function createRoom() {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ movieId: VALID_UUID }),
      redirect: 'manual',
    });
    const location = res.headers.get('location')!;
    const roomId = location.split('/').pop()!;
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    return { roomId, cookie };
  }

  it('shows the movie, room URL, copy button, and admin badge for the creator', async () => {
    const { roomId, cookie } = await createRoom();

    const res = await fetch(`${baseUrl}/room/${roomId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('You are the admin');
    expect(html).toContain(`/movie/${VALID_UUID}`);
    expect(html).toContain(`${baseUrl}/room/${roomId}`);
    expect(html).toContain('Copy');
  });

  it('treats a different visitor as a viewer', async () => {
    const { roomId } = await createRoom();

    // No cookie → new anonymous identity → viewer.
    const res = await fetch(`${baseUrl}/room/${roomId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('You are a viewer');
    expect(html).not.toContain('You are the admin');
  });

  it('returns 404 for an invalid room ID', async () => {
    const res = await fetch(
      `${baseUrl}/room/00000000-0000-4000-8000-000000000000`,
    );
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('Room not found');
  });

  it('returns 404 for a malformed room ID', async () => {
    const res = await fetch(`${baseUrl}/room/not-a-uuid`);
    expect(res.status).toBe(404);
  });
});
