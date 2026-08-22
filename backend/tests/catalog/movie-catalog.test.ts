import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CatalogError,
  MovieCatalogService,
  MovieNotInCatalogError,
} from '../../src/services/movie-catalog.service.js';

let tempDir: string;

async function writeCatalog(contents: unknown): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'pw-catalog-'));
  const path = join(tempDir, 'movies.json');
  await writeFile(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return path;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe('MovieCatalogService', () => {
  it('loads and returns movies from a valid catalog', async () => {
    const path = await writeCatalog([
      {
        id: 'interstellar',
        title: 'Interstellar',
        year: 2014,
        duration: '2h 49m',
        thumbnail: 'interstellar.jpg',
        filename: 'interstellar.mp4',
      },
    ]);

    const catalog = new MovieCatalogService();
    const movies = await catalog.load(path);

    expect(movies).toHaveLength(1);
    expect(catalog.getAll()).toHaveLength(1);
    expect(catalog.getBySlug('interstellar').title).toBe('Interstellar');
  });

  it('throws CatalogError for a missing file', async () => {
    const catalog = new MovieCatalogService();
    await expect(catalog.load(join(tmpdir(), 'does-not-exist.json'))).rejects.toThrow(
      CatalogError,
    );
  });

  it('throws CatalogError for invalid JSON', async () => {
    const path = await writeCatalog('not json');
    const catalog = new MovieCatalogService();
    await expect(catalog.load(path)).rejects.toThrow(CatalogError);
  });

  it('throws CatalogError for an entry missing required fields', async () => {
    const path = await writeCatalog([{ id: 'interstellar' }]);
    const catalog = new MovieCatalogService();
    await expect(catalog.load(path)).rejects.toThrow(CatalogError);
  });

  it('throws CatalogError for duplicate ids', async () => {
    const path = await writeCatalog([
      {
        id: 'a',
        title: 'A',
        year: 2000,
        duration: '1h',
        thumbnail: 'a.jpg',
        filename: 'a.mp4',
      },
      {
        id: 'a',
        title: 'A again',
        year: 2001,
        duration: '1h',
        thumbnail: 'a2.jpg',
        filename: 'a2.mp4',
      },
    ]);
    const catalog = new MovieCatalogService();
    await expect(catalog.load(path)).rejects.toThrow(CatalogError);
  });

  it('throws CatalogError for duplicate filenames', async () => {
    const path = await writeCatalog([
      {
        id: 'a',
        title: 'A',
        year: 2000,
        duration: '1h',
        thumbnail: 'a.jpg',
        filename: 'same.mp4',
      },
      {
        id: 'b',
        title: 'B',
        year: 2001,
        duration: '1h',
        thumbnail: 'b.jpg',
        filename: 'same.mp4',
      },
    ]);
    const catalog = new MovieCatalogService();
    await expect(catalog.load(path)).rejects.toThrow(CatalogError);
  });

  it('getBySlug throws MovieNotInCatalogError for an unknown slug', async () => {
    const path = await writeCatalog([]);
    const catalog = new MovieCatalogService();
    await catalog.load(path);
    expect(() => catalog.getBySlug('nope')).toThrow(MovieNotInCatalogError);
  });
});
