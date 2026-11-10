import type { FastifyRequest } from 'fastify';
import { supplierDocuments } from '../../../../lib/content/supplier-registration.ts';
import { maxSupplierFileSize, validateSupplierFile } from '../../../../lib/validation/supplier-registration.ts';
import { HttpError } from '../../common/errors.ts';
import { sha256 } from '../../common/hash.ts';
import type { StoredDocument } from '../../database/models.ts';

export const maxTotalUploadSize = 40 * 1024 * 1024;
const signatureMime = (bytes: Buffer) => {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  return '';
};

export async function readSupplierUpload(request: FastifyRequest) {
  if (!request.isMultipart()) throw new HttpError(415, 'MULTIPART_REQUIRED', 'أرسل البيانات والمستندات بصيغة multipart/form-data.');
  if (Number(request.headers['content-length']) > maxTotalUploadSize + 1024 * 1024) throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'الحد الإجمالي للمستندات هو 40 ميجابايت.');
  let payload: unknown;
  let hasPayload = false;
  let total = 0;
  const documents: StoredDocument[] = [];
  const names = new Set<string>();
  for await (const part of request.parts({ limits: {
    fileSize: maxSupplierFileSize, files: supplierDocuments.length, fields: 1,
    fieldSize: 128 * 1024, fieldNameSize: 100, parts: supplierDocuments.length + 1, headerPairs: 100,
  } })) {
    if (part.type === 'field') {
      if (part.fieldname !== 'payload' || hasPayload || part.valueTruncated || typeof part.value !== 'string') throw new HttpError(400, 'INVALID_PAYLOAD', 'بيانات الطلب غير صالحة.');
      hasPayload = true;
      total += Buffer.byteLength(part.value);
      try { payload = JSON.parse(part.value); }
      catch { throw new HttpError(400, 'INVALID_JSON', 'بيانات الطلب ليست JSON صالحاً.'); }
      continue;
    }
    if (!supplierDocuments.some(doc => doc.id === part.fieldname) || names.has(part.fieldname)) {
      part.file.resume();
      throw new HttpError(422, 'INVALID_DOCUMENT', 'يوجد مستند غير معروف أو مكرر.');
    }
    names.add(part.fieldname);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length; size += buffer.length;
      if (total > maxTotalUploadSize || size > maxSupplierFileSize) throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'الحد لكل ملف 10 ميجابايت والإجمالي 40 ميجابايت.');
      chunks.push(buffer);
    }
    if (part.file.truncated) throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'الحد لكل ملف 10 ميجابايت.');
    const bytes = Buffer.concat(chunks);
    const mime = signatureMime(bytes);
    const name = (part.filename.split(/[\\/]/).pop() ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
    const error = validateSupplierFile({ name, size, type: mime });
    if (!mime || error || (part.mimetype !== mime && part.mimetype !== 'application/octet-stream')) {
      throw new HttpError(422, 'INVALID_DOCUMENT', 'نوع المستند أو محتواه غير صالح.', [{ key: `document-${part.fieldname}`, step: 3, message: error || 'محتوى الملف لا يطابق نوعه.' }]);
    }
    documents.push({ type: part.fieldname, name, mime, bytes, hash: sha256(bytes) });
  }
  if (!hasPayload) throw new HttpError(400, 'MISSING_PAYLOAD', 'بيانات المورد مطلوبة.');
  return { payload, documents };
}
