import type { FastifyInstance } from 'fastify';
import { idempotencyKey } from '../../common/idempotency.ts';
import { HttpError } from '../../common/errors.ts';
import type { SubmissionRepository } from '../../database/submission.repository.ts';
import { readSupplierUpload } from './supplier.uploads.ts';
import { registerSupplier } from './supplier.service.ts';

export function supplierRoutes(app: FastifyInstance, repository: SubmissionRepository, rateLimit: number) {
  let activeUploads = 0;
  app.post('/suppliers', { config: { rateLimit: { max: rateLimit, timeWindow: '1 minute' } } }, async (request, reply) => {
    const key = idempotencyKey(request.headers['idempotency-key']);
    if (activeUploads >= 3) throw new HttpError(429, 'UPLOAD_CAPACITY', 'يرجى إعادة المحاولة بعد قليل.');
    activeUploads += 1;
    try {
      const { payload, documents } = await readSupplierUpload(request);
      const result = await registerSupplier(repository, payload, documents, key);
      return reply.code(result.replayed ? 200 : 201).send({ data: result.receipt, replayed: result.replayed });
    } finally { activeUploads -= 1; }
  });
}
