import { loadConfig } from './config/env.ts';
import { openDatabase } from './database/connection.ts';
import { buildApp } from './app.ts';

const config = loadConfig();
const { client, db } = await openDatabase(config.MONGODB_URI, config.MONGODB_DATABASE);
const app = await buildApp({ client, db, origins: config.origins, rateLimit: config.SUBMISSION_RATE_LIMIT, logLevel: config.LOG_LEVEL });
app.addHook('onClose', async () => { await client.close(); });
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  await app.close();
  clearTimeout(timeout);
};
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
try { await app.listen({ host: config.HOST, port: config.PORT }); }
catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
