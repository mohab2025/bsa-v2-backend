import { HttpError } from './errors.ts';

export function idempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) {
    throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'يجب إرسال مفتاح طلب صالح في Idempotency-Key.');
  }
  return value;
}
