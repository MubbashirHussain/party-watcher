import { join } from 'node:path';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';

export function resolveFilePath(uploadDir: string, fileName: string): string {
  // join() normalizes the path, so any "../" segments in fileName would escape
  // uploadDir. Verify the result still lives inside uploadDir.
  const resolvedUploadDir = resolve(uploadDir);
  const candidate = resolve(join(uploadDir, fileName));
  if (!candidate.startsWith(resolvedUploadDir + '/')) {
    throw new Error('Resolved file path escapes the upload directory');
  }
  return candidate;
}

export async function getFileSize(filePath: string): Promise<number> {
  const stats = await stat(filePath);
  return stats.size;
}

export function createFileStream(filePath: string, start?: number, end?: number): ReadStream {
  return createReadStream(filePath, { start, end });
}
