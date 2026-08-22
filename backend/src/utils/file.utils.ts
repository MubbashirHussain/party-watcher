import { join } from 'node:path';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';

export function resolveMoviePath(uploadDir: string, movieId: string): string {
  // join() normalizes the path, so any "../" segments in movieId would escape
  // uploadDir. Verify the result still lives inside uploadDir.
  const resolvedUploadDir = resolve(uploadDir);
  const candidate = resolve(join(uploadDir, `${movieId}.mp4`));
  if (!candidate.startsWith(resolvedUploadDir + '/')) {
    throw new Error('Resolved movie path escapes the upload directory');
  }
  return candidate;
}

export async function getFileSize(filePath: string): Promise<number> {
  const stats = await stat(filePath);
  return stats.size;
}

export function createVideoStream(
  filePath: string,
  start?: number,
  end?: number,
): ReadStream {
  return createReadStream(filePath, { start, end });
}
