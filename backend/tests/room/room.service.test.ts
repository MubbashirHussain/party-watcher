import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RoomService } from '../../src/services/room.service.js';

let dir: string;
let service: RoomService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rooms-test-'));
  service = new RoomService(join(dir, 'current.json'));
  await service.init();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('RoomService', () => {
  it('creates a public room by default with no password fields', async () => {
    const room = await service.createRoom('interstellar', 'user-1');

    expect(room.visibility).toBe('public');
    expect(room.passwordHash).toBeUndefined();
    expect(room.accessToken).toBeUndefined();

    const persisted = JSON.parse(
      await readFile(join(dir, 'current.json'), 'utf8'),
    );
    expect(persisted[room.id].visibility).toBe('public');
    expect(persisted[room.id].passwordHash).toBeUndefined();
    expect(persisted[room.id].accessToken).toBeUndefined();
  });

  it('creates a private room with a bcrypt hash and access token', async () => {
    const room = await service.createRoom('interstellar', 'user-1', {
      visibility: 'private',
      password: 'top-secret',
    });

    expect(room.visibility).toBe('private');
    expect(room.accessToken).toMatch(/^[0-9a-f-]{36}$/);

    const persisted = JSON.parse(
      await readFile(join(dir, 'current.json'), 'utf8'),
    );
    const stored = persisted[room.id];
    // Never persist the plaintext password.
    expect(JSON.stringify(persisted)).not.toContain('top-secret');
    // The hash has the bcrypt $2b$ shape and is not the plaintext.
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(stored.passwordHash).not.toBe('top-secret');
    expect(stored.accessToken).toBe(room.accessToken);
  });

  it('verifies the password for private rooms and rejects wrong ones', async () => {
    const room = await service.createRoom('interstellar', 'user-1', {
      visibility: 'private',
      password: 'correct-horse',
    });

    await expect(service.isPasswordCorrect(room.id, 'correct-horse')).resolves.toBe(
      true,
    );
    await expect(service.isPasswordCorrect(room.id, 'wrong')).resolves.toBe(false);
  });

  it('always rejects passwords for public rooms', async () => {
    const room = await service.createRoom('interstellar', 'user-1');
    await expect(service.isPasswordCorrect(room.id, 'anything')).resolves.toBe(
      false,
    );
  });

  it('loads legacy rooms without a visibility field as public', async () => {
    const legacy = {
      'room-legacy': {
        id: 'room-legacy',
        movieId: 'interstellar',
        adminId: 'user-1',
        users: [{ id: 'user-1', name: 'Host' }],
        playback: { paused: false, timeline: 0, quality: '720p' },
      },
    };
    await writeFile(join(dir, 'current.json'), JSON.stringify(legacy), 'utf8');

    const legacyService = new RoomService(join(dir, 'current.json'));
    await legacyService.init();

    const room = legacyService.getRoom('room-legacy');
    expect(room.visibility).toBe('public');
    expect(room.passwordHash).toBeUndefined();
  });

  it('throws when creating a private room without a password', async () => {
    await expect(
      service.createRoom('interstellar', 'user-1', { visibility: 'private' }),
    ).rejects.toThrow('Private rooms require a password');
  });

  it('updates playback state and persists it to disk', async () => {
    const room = await service.createRoom('interstellar', 'user-1');

    const updated = await service.updatePlayback(room.id, {
      paused: true,
      timeline: 120.5,
      quality: '1080p',
      speed: 1,
      updatedAt: 1234567890,
    });

    expect(updated.playback).toEqual({
      paused: true,
      timeline: 120.5,
      quality: '1080p',
      speed: 1,
      updatedAt: 1234567890,
    });

    const persisted = JSON.parse(
      await readFile(join(dir, 'current.json'), 'utf8'),
    );
    expect(persisted[room.id].playback).toEqual({
      paused: true,
      timeline: 120.5,
      quality: '1080p',
      speed: 1,
      updatedAt: 1234567890,
    });
  });
});
