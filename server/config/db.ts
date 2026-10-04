/** MongoDB connection lifecycle. */

import mongoose from 'mongoose';
import { config } from '../config/env.js';

let connected = false;

export async function connectDatabase(): Promise<typeof mongoose> {
  if (connected) return mongoose;

  mongoose.set('strictQuery', true);

  await mongoose.connect(config.mongoUri, {
    dbName: config.mongoDb,
    serverSelectionTimeoutMS: 10_000,
  });

  connected = true;
  // eslint-disable-next-line no-console
  console.log(`[db] connected to MongoDB (db: ${config.mongoDb})`);
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

export function isDatabaseConnected(): boolean {
  return connected && mongoose.connection.readyState === 1;
}
