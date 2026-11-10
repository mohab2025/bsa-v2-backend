import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Db, MongoClient } from 'mongodb';
import { HttpError } from './common/errors.ts';
import { SubmissionRepository } from './database/submission.repository.ts';
import { supplierRoutes } from './modules/suppliers/supplier.routes.ts';
import { serviceRequestRoutes } from './modules/service-requests/service-request.routes.ts';
import { serviceRoutes } from './modules/services/service.routes.ts';

export type AppOptions = { client: MongoClient; db: Db; origins: string[]; rateLimit?: number; logLevel?: string };
export async function buildApp(options: AppOptions) {
  const app = Fastify({
    bodyLimit: 128 * 1024, requestTimeout: 60_000, connectionTimeout: 65_000,
    trustProxy: false,
    logger: options.logLevel === 'silent' ? false : {
      level: options.logLevel ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.idempotency-key'],
      serializers: { req: request => ({ method: request.method, url: request.url?.split('?')[0] }) },
    },
  });
  await app.register(helmet);
  await app.register(cors, { origin: options.origins, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Idempotency-Key'], credentials: false });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(multipart);
  app.addHook('onRequest', async request => {
    const origin = request.headers.origin;
    if (origin && !options.origins.includes(origin)) throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'مصدر الطلب غير مسموح.');
  });
  app.addHook('onSend', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'بنية البيانات أو طول الحقول غير صالح.', issues: error.issues.map(issue => ({ key: issue.path[0] === 'details' ? String(issue.path[1]) : issue.path.join('.'), message: 'قيمة غير صالحة أو أطول من الحد المسموح.' })) }, requestId: request.id });
    }
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, ...(error.issues ? { issues: error.issues } : {}) }, requestId: request.id });
    const statusCode = typeof (error as { statusCode?: number }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
    if (statusCode >= 500) request.log.error({ err: error }, 'Intake request failed');
    return reply.code(statusCode >= 400 && statusCode <= 599 ? statusCode : 500).send({ error: {
      code: statusCode === 413 ? 'UPLOAD_TOO_LARGE' : statusCode === 429 ? 'RATE_LIMITED' : statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
      message: statusCode === 413 ? 'حجم الطلب أو المستندات يتجاوز الحد المسموح.' : statusCode === 429 ? 'طلبات كثيرة. يرجى المحاولة لاحقاً.' : statusCode >= 500 ? 'تعذر معالجة الطلب حالياً. يرجى إعادة المحاولة.' : 'الطلب غير صالح.',
    }, requestId: request.id });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'المسار غير موجود.' } }));
  const repository = new SubmissionRepository(options.client, options.db);
  await app.register(async api => {
    api.get('/health', async () => { await options.db.command({ ping: 1 }); return { status: 'ok' }; });
    serviceRoutes(api);
    supplierRoutes(api, repository, options.rateLimit ?? 10);
    serviceRequestRoutes(api, repository, options.rateLimit ?? 10);
  }, { prefix: '/api/intake/v1' });
  return app;
}
