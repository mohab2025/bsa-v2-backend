import { validateServiceRequest } from '../../../../lib/validation/service-request.ts';
import { normalizeMobile } from '../../../../lib/validation/supplier-registration.ts';
import { HttpError } from '../../common/errors.ts';
import { canonicalJson, sha256 } from '../../common/hash.ts';
import type { SubmissionRepository } from '../../database/submission.repository.ts';
import { serviceRequestSchema } from './service-request.schema.ts';

export async function createServiceRequest(repository: SubmissionRepository, payload: unknown, key: string) {
  const data = serviceRequestSchema.parse(payload);
  data.phone = normalizeMobile(data.phone);
  data.email = data.email.toLowerCase();
  const issues = validateServiceRequest(data);
  if (issues.length) throw new HttpError(422, 'VALIDATION_ERROR', 'يرجى تصحيح بيانات طلب الخدمة.', issues);
  return repository.create({ kind: 'service', key, hash: sha256(canonicalJson(data)), payload: data });
}
