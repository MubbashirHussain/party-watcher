import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Build a minimal but valid MP4 test fixture.
// A moov box after mdat is enough for range streaming to work in practice.

function box(type: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + payload.length);
  return Buffer.concat([size, Buffer.from(type, 'ascii'), payload]);
}

// Minimal empty moov box so the file still starts with ftyp (browser checks).
function moovBox(): Buffer {
  return box('moov', Buffer.alloc(8));
}

/** Writes the test fixture to the uploads directory. Returns its absolute path. */
export function generateFixture(): string {
  const dir = join(import.meta.dirname, '../../uploads');

  const ftyp = box(
    'ftyp',
    Buffer.concat([
      Buffer.from('isom', 'ascii'),
      Buffer.alloc(4), // minor version
      Buffer.from('isom', 'ascii'),
      Buffer.from('mp42', 'ascii'),
    ]),
  );

  // 2 MiB of zeros so range tests have room to work with.
  const mdat = box('mdat', Buffer.alloc(2 * 1024 * 1024));

  const fixture = Buffer.concat([ftyp, moovBox(), mdat]);
  const path = join(dir, 'test-movie.mp4');
  writeFileSync(path, fixture);
  return path;
}

// Allow running directly: npm run fixture
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  generateFixture();
}
