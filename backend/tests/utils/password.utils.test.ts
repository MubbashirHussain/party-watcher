import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/password.utils.js';

describe('password.utils', () => {
  it('hashes a password with bcrypt and verifies it', async () => {
    const hashed = await hashPassword('s3cret');
    expect(hashed).toMatch(/^\$2[aby]\$\d{2}\$/);
    await expect(verifyPassword('s3cret', hashed)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hashed = await hashPassword('right');
    await expect(verifyPassword('wrong', hashed)).resolves.toBe(false);
  });

  it('generates unique salts per hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('returns false for a missing or invalid hash', async () => {
    await expect(verifyPassword('x', undefined)).resolves.toBe(false);
    await expect(verifyPassword('x', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });
});
