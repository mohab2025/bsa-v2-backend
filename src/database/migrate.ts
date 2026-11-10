import { loadConfig } from '../config/env.ts';
import { openDatabase } from './connection.ts';

const config = loadConfig();
const { client } = await openDatabase(config.MONGODB_URI, config.MONGODB_DATABASE);
await client.close();
console.log('MongoDB migrations completed.');
