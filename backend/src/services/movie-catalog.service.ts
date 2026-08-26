import { Collection, MongoClient, ObjectId } from "mongodb";
import { z } from "zod";
import type { MovieMetadata } from "../types/movie-metadata.types.js";

const movieMetadataSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    slug: z.string().optional(),
    year: z.number().int(),
    duration: z.string().min(1),
    thumbnail: z.string().min(1),
    filename: z.string().min(1).endsWith(".mp4"),
    _id: z.instanceof(ObjectId),
    __v: z.number().optional(),
    genre: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();

export class CatalogError extends Error {
  constructor() {
    super("Movie catalog could not be read");
    this.name = "CatalogError";
  }
}

export class MovieNotInCatalogError extends Error {
  constructor() {
    super("Movie not in catalog");
    this.name = "MovieNotInCatalogError";
  }
}

let client: MongoClient | null = null;
let moviesCollection: Collection<MovieMetadata> | null = null;

async function getMoviesCollection() {
  if (moviesCollection) {
    return moviesCollection;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not defined");
  }

  client = new MongoClient(uri);
  await client.connect();

  const db = client.db(process.env.MONGODB_DB || "party-watch");

  moviesCollection = db.collection<MovieMetadata>("movies");

  await moviesCollection.createIndex({ id: 1 }, { unique: true });
  await moviesCollection.createIndex({ filename: 1 }, { unique: true });

  return moviesCollection;
}

export class MovieCatalogService {
  async load(_moviesFilePath?: string): Promise<MovieMetadata[]> {
    try {
      const collection = await getMoviesCollection();

      const movies = await collection.find({}).toArray();

      const result = z.array(movieMetadataSchema).safeParse(movies);

      if (!result.success) {
        throw new CatalogError();
      }

      return result.data;
    } catch (error) {
      if (error instanceof CatalogError) {
        throw error;
      }

      throw new CatalogError();
    }
  }

  async getAll(): Promise<MovieMetadata[]> {
    try {
      const collection = await getMoviesCollection();

      const movies = await collection.find({}).toArray();

      const result = z.array(movieMetadataSchema).safeParse(movies);

      if (!result.success) {
        throw new CatalogError();
      }

      return result.data;
    } catch (error) {
      if (error instanceof CatalogError) {
        throw error;
      }

      throw new CatalogError();
    }
  }

  async getBySlug(slug: string): Promise<MovieMetadata> {
    const collection = await getMoviesCollection();

    const movie = await collection.findOne({ id: slug });

    if (!movie) {
      throw new MovieNotInCatalogError();
    }

    const result = movieMetadataSchema.safeParse(movie);

    if (!result.success) {
      throw new CatalogError();
    }

    return result.data;
  }

  async getByFilename(filename: string): Promise<MovieMetadata | undefined> {
    const collection = await getMoviesCollection();

    const movie = await collection.findOne({ filename });

    if (!movie) {
      return undefined;
    }

    const result = movieMetadataSchema.safeParse(movie);

    if (!result.success) {
      throw new CatalogError();
    }

    return result.data;
  }

  async create(movie: MovieMetadata): Promise<MovieMetadata> {
    const collection = await getMoviesCollection();

    const result = movieMetadataSchema.safeParse(movie);

    if (!result.success) {
      throw new CatalogError();
    }

    await collection.insertOne(result.data);

    return result.data;
  }

  async update(
    id: string,
    data: Partial<Omit<MovieMetadata, "id">>,
  ): Promise<MovieMetadata> {
    const collection = await getMoviesCollection();

    const result = await collection.findOneAndUpdate(
      { id },
      { $set: data },
      { returnDocument: "after" },
    );

    if (!result) {
      throw new MovieNotInCatalogError();
    }

    const validated = movieMetadataSchema.safeParse(result);

    if (!validated.success) {
      throw new CatalogError();
    }

    return validated.data;
  }

  async delete(id: string): Promise<boolean> {
    const collection = await getMoviesCollection();

    const result = await collection.deleteOne({ id });

    if (result.deletedCount === 0) {
      throw new MovieNotInCatalogError();
    }

    return true;
  }
}
