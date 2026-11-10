import type { FastifyInstance } from 'fastify';
import { serviceData, clientTypes } from '../../../../lib/content/services.ts';
import { HttpError } from '../../common/errors.ts';

export function serviceRoutes(app: FastifyInstance) {
  app.get('/services', async () => ({ data: Object.entries(serviceData).map(([slug, service]) => ({ slug, ...service })), clientTypes }));
  app.get<{ Params: { slug: string } }>('/services/:slug', async request => {
    if (!Object.hasOwn(serviceData, request.params.slug)) throw new HttpError(404, 'SERVICE_NOT_FOUND', 'الخدمة غير موجودة.');
    return { data: { slug: request.params.slug, ...serviceData[request.params.slug] } };
  });
}
