import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { loadEnv } from '../../src/config/env.js';
import { buildApp } from '../../src/server.js';
import { generateFixture } from '../fixtures/generate-fixture.js';

process.env.UPLOAD_DIR = './uploads';
process.env.PORT = '0';
process.env.MOVIES_FILE = './data/movies.json';

const SLUG = 'interstellar';

let app: FastifyInstance;
let baseUrl: string;
let roomsDir: string;

beforeAll(async () => {
  roomsDir = await mkdtemp(join(tmpdir(), 'pw-sync-'));
  process.env.ROOMS_FILE = join(roomsDir, 'current.json');
  loadEnv();
  // POST /rooms validates the movie file on disk, so the fixture must exist.
  generateFixture();
  await copyFile(
    join(process.cwd(), 'uploads', 'test-movie.mp4'),
    join(process.cwd(), 'uploads', 'interstellar.mp4'),
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
  const userId = cookie.split('=')[1]!;
  return { roomId, cookie, userId };
}

/** Joins a room with a display name, returning the user's session cookie. */
async function joinRoom(roomId: string) {
  const res = await fetch(`${baseUrl}/room/${roomId}`);
  const sessionCookie = res.headers.get('set-cookie')!.split(';')[0]!;
  const userId = sessionCookie.split('=')[1]!;

  await fetch(`${baseUrl}/room/${roomId}/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: sessionCookie,
    },
    body: new URLSearchParams({ name: 'Viewer' }),
    redirect: 'manual',
  });
  return { cookie: sessionCookie, userId };
}

function wsUrl(roomId: string, userId: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.searchParams.set('roomId', roomId);
  url.searchParams.set('userId', userId);
  return url.toString();
}

/** Connects a WebSocket, resolves with the first 'sync' message playback. */
function connect(
  roomId: string,
  cookie: string,
): Promise<{ ws: WebSocket; sync: { paused: boolean; timeline: number; quality: string } }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(roomId, cookie.split('=')[1]!), {
      headers: { Cookie: cookie },
    });
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'sync') {
        clearTimeout(timer);
        resolve({ ws, sync: message.playback });
      }
    });
    ws.on('error', reject);
  });
}

/** Waits for the next message of a given type on the socket. */
function nextMessage(
  ws: WebSocket,
  type: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      timeoutMs,
    );
    const onMessage = (data: unknown) => {
      const message = JSON.parse((data as Buffer).toString());
      if (message.type === type) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(message);
      }
    };
    ws.on('message', onMessage);
  });
}

describe('WebSocket playback sync', () => {
  it('broadcasts host playback events to viewers and persists state', async () => {
    const { roomId, cookie: hostCookie } = await createRoom();
    const { cookie: viewerCookie } = await joinRoom(roomId);

    const host = await connect(roomId, hostCookie);
    const viewer = await connect(roomId, viewerCookie);

    try {
      // Host plays → viewer receives play with timeline.
      host.ws.send(JSON.stringify({ type: 'play', timeline: 120.5 }));
      const playMsg = await nextMessage(viewer.ws, 'play');
      expect(playMsg.timeline).toBe(120.5);

      // Host pauses → viewer receives pause with timeline.
      host.ws.send(JSON.stringify({ type: 'pause', timeline: 135.2 }));
      const pauseMsg = await nextMessage(viewer.ws, 'pause');
      expect(pauseMsg.timeline).toBe(135.2);

      // Host seeks → viewer receives seek.
      host.ws.send(JSON.stringify({ type: 'seek', timeline: 350.2 }));
      const seekMsg = await nextMessage(viewer.ws, 'seek');
      expect(seekMsg.timeline).toBe(350.2);

      // Host changes quality → viewer receives quality.
      host.ws.send(JSON.stringify({ type: 'quality', quality: '1080p' }));
      const qualityMsg = await nextMessage(viewer.ws, 'quality');
      expect(qualityMsg.quality).toBe('1080p');

      // State is persisted to the room store (poll for the async write).
      const readRooms = async () =>
        JSON.parse(
          await (await import('node:fs/promises')).readFile(
            join(roomsDir, 'current.json'),
            'utf8',
          ),
        );
      await expect
        .poll(async () => (await readRooms())[roomId].playback)
        .toEqual({ paused: true, timeline: 350.2, quality: '1080p' });
    } finally {
      host.ws.close();
      viewer.ws.close();
    }
  });

  it('ignores playback commands sent by viewers', async () => {
    const { roomId, cookie: hostCookie } = await createRoom();
    const { cookie: viewerCookie } = await joinRoom(roomId);

    const host = await connect(roomId, hostCookie);
    const viewer = await connect(roomId, viewerCookie);

    try {
      // Viewer attempts to control playback — the server must drop it, so the
      // host never receives a play event.
      viewer.ws.send(JSON.stringify({ type: 'play', timeline: 999 }));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const readRooms = async () =>
        JSON.parse(
          await (await import('node:fs/promises')).readFile(
            join(roomsDir, 'current.json'),
            'utf8',
          ),
        );
      const room = await readRooms();
      expect(room[roomId].playback.paused).toBe(false);
      expect(room[roomId].playback.timeline).toBe(0);

      // The host can still drive playback normally afterwards.
      host.ws.send(JSON.stringify({ type: 'seek', timeline: 42 }));
      const seekMsg = await nextMessage(viewer.ws, 'seek');
      expect(seekMsg.timeline).toBe(42);
    } finally {
      host.ws.close();
      viewer.ws.close();
    }
  });

  it('sends current playback state to a newly joined viewer', async () => {
    const { roomId, cookie: hostCookie } = await createRoom();

    const host = await connect(roomId, hostCookie);
    try {
      host.ws.send(JSON.stringify({ type: 'pause', timeline: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 300));

      const { cookie: viewerCookie } = await joinRoom(roomId);
      const viewer = await connect(roomId, viewerCookie);
      try {
        expect(viewer.sync).toEqual({
          paused: true,
          timeline: 200,
          quality: '720p',
        });
      } finally {
        viewer.ws.close();
      }
    } finally {
      host.ws.close();
    }
  });

  it('rejects connections without a matching session cookie', async () => {
    const { roomId } = await createRoom();

    // Unknown userId with no cookie → 401 and the connection is closed.
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl(roomId, 'forged-user-id'));
        ws.on('open', () => reject(new Error('Connection should not open')));
        ws.on('error', () => resolve());
        setTimeout(() => reject(new Error('Connection did not fail')), 5000);
      }),
    ).resolves.toBeUndefined();
  });

  it('lets the same user reconnect without duplicate sessions', async () => {
    const { roomId, cookie: hostCookie } = await createRoom();
    const { cookie: viewerCookie } = await joinRoom(roomId);

    const firstHost = await connect(roomId, hostCookie);
    const viewer = await connect(roomId, viewerCookie);

    // The host reconnects (e.g. after a reload) with the same userId.
    const secondHost = await connect(roomId, hostCookie);

    // The stale connection is closed by the newer one.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      firstHost.ws.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // The new host connection still drives playback for viewers.
    secondHost.ws.send(JSON.stringify({ type: 'play', timeline: 10 }));
    const playMsg = await nextMessage(viewer.ws, 'play');
    expect(playMsg.timeline).toBe(10);

    secondHost.ws.close();
    viewer.ws.close();
  });
});
