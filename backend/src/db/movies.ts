import { Collection, Db, MongoClient } from "mongodb";
import { loadEnv } from "../config/env.js";

export interface Movie {
  id: string;
  title: string;
  year: number;
  description?: string;
  slug?: string;
  duration: string;
  thumbnail?: string;
  genre?: string;
  url?: string;
  filename: string;
  _id?: string;
  __v?: number;
}

let client: MongoClient | null = null;
let db: Db | null = null;
let movies: Collection<Movie> | null = null;

export async function connectDB(): Promise<void> {
  if (client) return;

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not defined");
  }

  client = new MongoClient(uri);
  await client.connect();

  const dbName = process.env.MONGODB_DB || "watch-party";
  db = client.db(dbName);
  movies = db.collection<Movie>("movies");

  await movies.createIndex({ id: 1 }, { unique: true });
  await movies.createIndex({ filename: 1 }, { unique: true });
}

export async function closeDB(): Promise<void> {
  if (!client) return;

  await client.close();

  client = null;
  db = null;
  movies = null;
}

function getCollection(): Collection<Movie> {
  if (!movies) {
    throw new Error("MongoDB is not connected");
  }

  return movies;
}

// Get all movies
export async function getAllMovies(): Promise<Movie[]> {
  return getCollection().find({}).toArray();
}

// Get movie by ID
export async function getMovieById(id: string): Promise<Movie | null> {
  return getCollection().findOne({ id });
}

// Get movie by filename
export async function getMovieByFilename(
  filename: string,
): Promise<Movie | null> {
  return getCollection().findOne({ filename });
}

// Add movie
export async function createMovie(movie: Movie): Promise<Movie> {
  await getCollection().insertOne(movie);

  return movie;
}

// Update movie
export async function updateMovie(
  id: string,
  data: Partial<Omit<Movie, "id">>,
): Promise<Movie | null> {
  return getCollection().findOneAndUpdate(
    { id },
    { $set: data },
    { returnDocument: "after" },
  );
}

// Delete movie
export async function deleteMovie(id: string): Promise<boolean> {
  const result = await getCollection().deleteOne({ id });

  return result.deletedCount === 1;
}
