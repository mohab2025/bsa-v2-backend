import type { FastifyInstance } from 'fastify';
import { idempotencyKey } from '../../common/idempotency.ts';
import type { SubmissionRepository } from '../../database/submission.repository.ts';
import { createServiceRequest } from './service-request.service.ts';

export function serviceRequestRoutes(app: FastifyInstance, repository: SubmissionRepository, rateLimit: number) {
  app.post('/service-requests', { bodyLimit: 32 * 1024, config: { rateLimit: { max: rateLimit, timeWindow: '1 minute' } } }, async (request, reply) => {
    const result = await createServiceRequest(repository, request.body, idempotencyKey(request.headers['idempotency-key']));
    return reply.code(result.replayed ? 200 : 201).send({ data: result.receipt, replayed: result.replayed });
  });
}
