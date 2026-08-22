import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
const ROOM_PASSWORD = 's3cret-room';

let app: FastifyInstance;
let baseUrl: string;
let roomsDir: string;

beforeAll(async () => {
  // Rooms are written to a temp file so tests never pollute data/current.json.
  roomsDir = await mkdtemp(join(tmpdir(), 'pw-rooms-'));
  process.env.ROOMS_FILE = join(roomsDir, 'current.json');
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
  await rm(roomsDir, { recursive: true, force: true });
});

/** Creates a room and returns its id plus the session cookie from creation. */
async function createRoom(body: Record<string, string> = { movieId: SLUG }) {
  const res = await fetch(`${baseUrl}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    redirect: 'manual',
  });
  const location = res.headers.get('location')!;
  const roomId = location.split('/').pop()!;
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  return { roomId, cookie };
}

describe('GET /', () => {
  it('renders the modern movie grid from catalog metadata', async () => {
    const res = await fetch(baseUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Party Watch');
    expect(html).toContain('Watch together');
    expect(html).toContain('Search movies');
    expect(html).toContain('Interstellar');
    expect(html).toContain('2014');
    expect(html).toContain('2h 49m');
    expect(html).toContain('/movie/interstellar/thumbnail');
    // Movie cards are identified by slug, not UUID.
    expect(html).toContain('name="movieId" value="interstellar"');
    // Each card offers Public/Private visibility.
    expect(html).toContain('value="public"');
    expect(html).toContain('value="private"');
    expect(html).toContain('Room password...');
  });
});

describe('POST /rooms', () => {
  it('creates a public room by default, sets a session cookie, and redirects', async () => {
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

  it('creates a private room when visibility=private with a password', async () => {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        movieId: SLUG,
        visibility: 'private',
        password: ROOM_PASSWORD,
      }),
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/^\/room\/[0-9a-f-]{36}$/);
  });

  it('rejects a private room without a password', async () => {
    const res = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ movieId: SLUG, visibility: 'private' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
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

describe('GET /room/:roomId (public room)', () => {
  it('renders the room page with movie metadata, overlay, and host badge for the creator', async () => {
    const { roomId, cookie } = await createRoom();

    const res = await fetch(`${baseUrl}/room/${roomId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('Interstellar');
    expect(html).toContain('2014');
    expect(html).toContain('2h 49m');
    expect(html).toContain('Host');
    expect(html).toContain(`/movie/interstellar`);
    expect(html).toContain(`${baseUrl}/room/${roomId}`);
    expect(html).toContain('Copy');
    // The lock screen must NOT appear for public rooms.
    expect(html).not.toContain('This room is private');
    // The player must be present.
    expect(html).toContain('id="videoElement"');
  });

  it('treats a different visitor as a viewer and shows the join modal', async () => {
    const { roomId } = await createRoom();

    const res = await fetch(`${baseUrl}/room/${roomId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Viewer');
    expect(html).not.toContain('>Host<');
    expect(html).toContain('Join Watch Room');
  });
});

describe('GET /room/:roomId (private room)', () => {
  async function createPrivateRoom() {
    return createRoom({
      movieId: SLUG,
      visibility: 'private',
      password: ROOM_PASSWORD,
    });
  }

  it('shows a lock screen to a visitor without access', async () => {
    const { roomId } = await createPrivateRoom();

    const res = await fetch(`${baseUrl}/room/${roomId}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('This room is private');
    expect(html).toContain(`/room/${roomId}/password`);
    // The player must be hidden until the room is unlocked.
    expect(html).not.toContain('id="videoElement"');
    expect(html).not.toContain('Join Watch Room');
    // Only the anonymous pw_session cookie is set — never a room access cookie.
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^pw_session=[0-9a-f-]{36};/);
    expect(setCookie).not.toContain('pw_room_');
  });

  it('lets the admin (host) view the room without a password', async () => {
    const { roomId, cookie } = await createPrivateRoom();

    const res = await fetch(`${baseUrl}/room/${roomId}`, {
      headers: { Cookie: cookie },
    });
    const html = await res.text();
    expect(html).toContain('Host');
    expect(html).not.toContain('This room is private');
    expect(html).toContain('id="videoElement"');
    // The private badge is shown.
    expect(html).toContain('Private');
  });

  it('shows an error after a wrong password', async () => {
    const { roomId } = await createPrivateRoom();

    const res = await fetch(`${baseUrl}/room/${roomId}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'wrong-password' }),
      redirect: 'manual',
    });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/room/${roomId}?pwError=1`);
    // No access cookie is granted on a wrong password.
    expect(res.headers.get('set-cookie')).toBeNull();

    const page = await fetch(`${baseUrl}/room/${roomId}?pwError=1`);
    const html = await page.text();
    expect(html).toContain('That password is incorrect.');
  });

  it('grants access on a correct password, then allows joining', async () => {
    const { roomId } = await createPrivateRoom();

    // First visit sets the anonymous pw_session cookie and shows the lock.
    const firstVisit = await fetch(`${baseUrl}/room/${roomId}`);
    const sessionCookie = firstVisit.headers.get('set-cookie')!.split(';')[0]!;
    expect(sessionCookie).toMatch(/^pw_session=[0-9a-f-]{36}$/);

    // Unlock with the correct password while holding the session cookie.
    const unlock = await fetch(`${baseUrl}/room/${roomId}/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: sessionCookie,
      },
      body: new URLSearchParams({ password: ROOM_PASSWORD }),
      redirect: 'manual',
    });

    expect(unlock.status).toBe(303);
    expect(unlock.headers.get('location')).toBe(`/room/${roomId}`);
    const accessCookie = unlock.headers.get('set-cookie');
    expect(accessCookie).toMatch(
      new RegExp(`^pw_room_${roomId}=[0-9a-f-]{36};`),
    );
    expect(accessCookie).toContain('Path=/room/');
    const roomAccessCookie = accessCookie!.split(';')[0]!;
    const bothCookies = `${sessionCookie}; ${roomAccessCookie}`;

    // With the access cookie the visitor now sees the player + join modal.
    const unlocked = await fetch(`${baseUrl}/room/${roomId}`, {
      headers: { Cookie: bothCookies },
    });
    const unlockedHtml = await unlocked.text();
    expect(unlockedHtml).not.toContain('This room is private');
    expect(unlockedHtml).toContain('id="videoElement"');
    expect(unlockedHtml).toContain('Join Watch Room');

    // Joining without the access cookie is blocked (redirected to the lock).
    const blockedJoin = await fetch(`${baseUrl}/room/${roomId}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: sessionCookie,
      },
      body: new URLSearchParams({ name: 'Sneaky' }),
      redirect: 'manual',
    });
    expect(blockedJoin.status).toBe(302);
    expect(blockedJoin.headers.get('location')).toBe(`/room/${roomId}`);

    // Joining with the access cookie works and renders the room without modals.
    const join = await fetch(`${baseUrl}/room/${roomId}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: bothCookies,
      },
      body: new URLSearchParams({ name: 'Alex' }),
      redirect: 'manual',
    });
    expect(join.status).toBe(302);
    expect(join.headers.get('location')).toBe(`/room/${roomId}`);

    const joined = await fetch(`${baseUrl}/room/${roomId}`, {
      headers: { Cookie: bothCookies },
    });
    const joinedHtml = await joined.text();
    expect(joinedHtml).not.toContain('Join Watch Room');
    // The user's name appears as the avatar initial in the room overlay.
    expect(joinedHtml).toMatch(/>\s*A\s*<\/div>/);
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
