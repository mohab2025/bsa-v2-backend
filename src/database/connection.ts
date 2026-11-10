import { MongoClient, type Db } from 'mongodb';
import * as initialMigration from './migrations/001-intake.ts';

export async function migrateDatabase(db: Db) {
  for (const migration of [initialMigration]) {
    const history = db.collection<{ _id: string; appliedAt: Date }>('schema_migrations');
    if (!(await history.findOne({ _id: migration.name }))) {
      await migration.up(db);
      await history.updateOne({ _id: migration.name }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
    }
  }
}
export async function openDatabase(uri: string, database: string) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 10 });
  try {
    await client.connect();
    const db = client.db(database);
    const hello = await db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('MongoDB must be a replica set or Atlas cluster to support atomic submissions.');
    await migrateDatabase(db);
    return { client, db };
  } catch (error) { await client.close(); throw error; }
}
