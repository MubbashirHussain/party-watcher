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
