import { z } from 'zod';

const envSchema = z.object({
  // 0 is allowed so callers can request an ephemeral port (useful in tests).
  PORT: z.coerce.number().int().min(0).default(3000),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
