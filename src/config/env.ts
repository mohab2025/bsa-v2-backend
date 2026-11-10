import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
export function loadConfig() {
  const envPath = resolve(backendRoot, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const env = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//).default('mongodb://127.0.0.1:27017/?replicaSet=rs0'),
    MONGODB_DATABASE: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('bsa_intake'),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173'),
    LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
    SUBMISSION_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  }).parse(process.env);
  const origins = env.CORS_ORIGINS.split(',').map(value => new URL(value.trim()).origin);
  return { ...env, origins };
}
