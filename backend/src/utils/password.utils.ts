import { hash, compare } from 'bcryptjs';

/**
 * bcrypt work factor. 12 is a deliberate balance for this MVP: fast enough
 * for room creation, slow enough (~250ms per attempt) to double as a
 * brute-force throttle for room passwords.
 */
export const BCRYPT_ROUNDS = 12;

/** Hashes a plaintext password with bcrypt. Never store plaintext. */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

/**
 * Compares a plaintext password against a bcrypt hash.
 * Returns false when the hash is missing or invalid.
 */
export async function verifyPassword(
  plain: string,
  hashed: string | undefined,
): Promise<boolean> {
  if (!hashed) {
    return false;
  }
  try {
    return await compare(plain, hashed);
  } catch {
    return false;
  }
}
