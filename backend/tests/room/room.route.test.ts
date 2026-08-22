import { copyFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../../src/config/env.js';
import { buildApp } from '../../src/server.js';
import { generateFixture } from '../fixtures/generate-fixture.js';

process.env.UPLOAD_DIR = './uploads';
process.env.PORT = '0';
process.env.MOVIES_FILE = './data/movies.json';

const SLUG = 'interstellar';

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  loadEnv();
  generateFixture();
  await copyFile(
    join(process.cwd(), 'uploads', 'test-movie.mp4'),
    join(process.cwd(), 'uploads', 'interstellar.mp4'),
  );
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
  await rm(join(process.cwd(), 'uploads', 'interstellar.mp4'), { force: true });
});

describe('GET /', () => {
  it('renders the modern movie grid from catalog metadata', async () => {
    const res = await fetch(baseUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Party Watch');
    expect(html).toContain('Watch together.');
    expect(html).toContain('Search movies');
    expect(html).toContain('Interstellar');
    expect(html).toContain('2014 · 2h 49m');
    expect(html).toContain('/movie/interstellar/thumbnail');
    // Movie cards are identified by slug, not UUID.
    expect(html).toContain('name="movieId" value="interstellar"');
  });
});

describe('POST /rooms', () => {
  it('creates a room, sets a session cookie, and redirects to /room/:roomId', async () => {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ movieId: SLUG }),
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/^\/room\/[0-9a-f-]{36}$/);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toMatch(/^pw_session=[0-9a-f-]{36};/);
  });

  it('rejects a movie not in the catalog', async () => {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ movieId: 'not-in-catalog' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid movie ID', async () => {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ movieId: 'not a valid slug!' }),
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
      body: new URLSearchParams({ movieId: SLUG }),
      redirect: 'manual',
    });
    const location = res.headers.get('location')!;
    const roomId = location.split('/').pop()!;
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    return { roomId, cookie };
  }

  it('renders the room page with movie metadata, overlay, and host badge for the creator', async () => {
    const { roomId, cookie } = await createRoom();

    const res = await fetch(`${baseUrl}/room/${roomId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('Interstellar');
    expect(html).toContain('2014 · 2h 49m');
    expect(html).toContain('Host');
    expect(html).toContain(`/movie/interstellar`);
    expect(html).toContain(`${baseUrl}/room/${roomId}`);
    expect(html).toContain('Copy');
    // The room overlay must start hidden.
    expect(html).toMatch(/roomStage/);
    expect(html).toMatch(/roomOverlay/);
    expect(html).toMatch(/overlay-visible/); // class toggled by JS
  });

  it('treats a different visitor as a viewer', async () => {
    const { roomId } = await createRoom();

    const res = await fetch(`${baseUrl}/room/${roomId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Viewer');
    expect(html).not.toContain('>Host<');
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
