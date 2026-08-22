import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Cookie used to persist the lightweight anonymous user/session ID. */
export const SESSION_COOKIE = 'pw_session';

/**
 * Returns the anonymous user/session ID for this visitor, generating and
 * persisting one via cookie if this is their first request.
 *
 * No authentication is performed — the ID is just an opaque identity used to
 * determine room admin membership. It is fine that a user can clear the
 * cookie; adminship is best-effort for this MVP.
 */
export function getOrCreateUserId(
  request: FastifyRequest,
  reply: FastifyReply,
): string {
  const existing = request.cookies[SESSION_COOKIE];
  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }

  const userId = randomUUID();
  reply.setCookie(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // MVP sessions are not durable across browser restarts.
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return userId;
}

/** Cookie name holding the access token for a specific private room. */
export function roomAccessCookieName(roomId: string): string {
  return `pw_room_${roomId}`;
}

/**
 * Grants access to a private room by persisting the room's access token in
 * an httpOnly cookie scoped to that room's routes. The token value is stored
 * on the room record, so the cookie cannot be forged without knowing it.
 */
export function setRoomAccessCookie(
  reply: FastifyReply,
  roomId: string,
  accessToken: string,
): void {
  reply.setCookie(roomAccessCookieName(roomId), accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: `/room/${roomId}`,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

/** Removes the room access cookie (e.g. when a room becomes public). */
export function clearRoomAccessCookie(reply: FastifyReply, roomId: string): void {
  reply.clearCookie(roomAccessCookieName(roomId), { path: `/room/${roomId}` });
}

/**
 * Returns true when the visitor holds the room's access-token cookie.
 * Public rooms and room admins never need this check.
 */
export function hasRoomAccess(
  request: FastifyRequest,
  roomId: string,
  accessToken: string | undefined,
): boolean {
  if (!accessToken) {
    return false;
  }
  const cookie = request.cookies[roomAccessCookieName(roomId)];
  return typeof cookie === 'string' && cookie === accessToken;
}
