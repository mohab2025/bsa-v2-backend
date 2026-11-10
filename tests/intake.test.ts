import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/database/connection.ts';
import { initialSupplierDetails } from '../../lib/content/supplier-registration.ts';

let mongo: MongoMemoryReplSet | undefined;
let connection: Awaited<ReturnType<typeof openDatabase>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const prefix = '/api/intake/v1';
const origin = 'http://localhost:3000';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
let registration = 1010000000;

before(async () => {
  const uri = process.env.TEST_MONGODB_URI;
  if (!uri) mongo = await MongoMemoryReplSet.create({
    binary: { downloadDir: fileURLToPath(new URL('../node_modules/.cache/mongodb/', import.meta.url)) },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  connection = await openDatabase(uri || mongo!.getUri(), `bsa_test_${randomUUID().replaceAll('-', '')}`);
  app = await buildApp({ ...connection, origins: [origin], logLevel: 'silent', rateLimit: 1000 });
}, { timeout: 240_000 });

after(async () => {
  await app?.close();
  if (connection) { await connection.db.dropDatabase(); await connection.client.close(); }
  await mongo?.stop();
});

function supplier() {
  return { details: { ...initialSupplierDetails, nameAr: 'شركة الاختبار', entityType: 'شركة', registration: String(registration++), taxRegistered: 'لا', region: 'مكة المكرمة', city: 'جدة', address: 'ABCD1234', contact: 'مسؤول الاختبار', role: 'مدير', phone: '0501234567', email: 'SUPPLIER@example.com', description: 'خدمات مساندة', engineeringRegulated: 'لا', contractorRegulated: 'لا', specializedRegulated: 'لا' },
    types: ['support'], categories: ['support'], subcategories: {}, regions: ['مكة المكرمة'], documentExpiry: {}, accurate: true, authorized: true, privacy: true,
  };
}
type Upload = { id: string; name?: string; mime?: string; bytes?: Buffer };
function multipart(payload: unknown, files: Upload[] = [{ id: 'registration' }, { id: 'profile' }]) {
  const boundary = `bsa-${randomUUID()}`;
  const chunks: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`)];
  for (const file of files) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.id}"; filename="${file.name ?? 'document.pdf'}"\r\nContent-Type: ${file.mime ?? 'application/pdf'}\r\n\r\n`), file.bytes ?? pdf, Buffer.from('\r\n'));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'idempotency-key': randomUUID(), origin } };
}
const service = () => ({ name: 'عميل الاختبار', role: '', clientType: 'شركة مقاولات', phone: '٠٥٠١٢٣٤٥٦٧', email: 'CLIENT@example.com', serviceSlug: 'project-management', notes: 'تفاصيل المشروع' });

test('health and catalog are readable but supplier data and files are not public', async () => {
  assert.equal((await app.inject({ url: `${prefix}/health` })).statusCode, 200);
  assert.ok((await app.inject({ url: `${prefix}/services` })).json().data.length > 0);
  assert.equal((await app.inject({ url: `${prefix}/services/project-management` })).statusCode, 200);
  assert.equal((await app.inject({ url: `${prefix}/services/unknown` })).statusCode, 404);
  assert.equal((await app.inject({ url: `${prefix}/suppliers` })).statusCode, 404);
  assert.equal((await app.inject({ url: `${prefix}/documents/registration` })).statusCode, 404);
});

test('supplier and private files persist in MongoDB, with a normalized receipt and retry protection', async () => {
  const payload = supplier();
  const request = multipart(payload);
  const first = await app.inject({ method: 'POST', url: `${prefix}/suppliers`, ...request });
  assert.equal(first.statusCode, 201, first.body);
  assert.match(first.json().data.reference, /^SUP-/);
  const stored = await connection.db.collection('submissions').findOne({ registration: payload.details.registration });
  assert.equal(stored?.payload.details.phone, '+966501234567');
  assert.equal(stored?.payload.details.email, 'supplier@example.com');
  assert.equal(await connection.db.collection('supplier_documents').countDocuments({ submissionId: stored?._id }), 2);
  assert.equal((await connection.db.collection('supplier_documents').findOne({ submissionId: stored?._id }))?.verificationStatus, 'unverified');
  const retry = await app.inject({ method: 'POST', url: `${prefix}/suppliers`, ...request });
  assert.equal(retry.statusCode, 200, retry.body);
  assert.deepEqual(retry.json().data, first.json().data);
  assert.equal(await connection.db.collection('supplier_documents').countDocuments({ submissionId: stored?._id }), 2);
  const duplicate = await app.inject({ method: 'POST', url: `${prefix}/suppliers`, ...multipart(payload) });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'SUPPLIER_EXISTS');
});

test('concurrent supplier registrations enforce the unique CR index', async () => {
  const payload = supplier();
  const responses = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `${prefix}/suppliers`, ...multipart(payload) })));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [201, 409]);
  assert.equal(await connection.db.collection('submissions').countDocuments({ registration: payload.details.registration }), 1);
});

test('conditional VAT and declarations are enforced on the server without partial saves', async () => {
  const payload = supplier(); payload.details.taxRegistered = 'نعم'; payload.privacy = false;
  const response = await app.inject({ method: 'POST', url: `${prefix}/suppliers`, ...multipart(payload) });
  assert.equal(response.statusCode, 422, response.body);
  const keys = response.json().error.issues.map((issue: { key: string }) => issue.key);
  for (const key of ['taxNumber', 'document-vat', 'privacy']) assert.ok(keys.includes(key));
  assert.equal(await connection.db.collection('submissions').countDocuments({ registration: payload.details.registration }), 0);
});

test('unknown body properties and invalid optional values are rejected', async () => {
  const payload = supplier(); payload.details.tenderEmail = 'bad-email';
  assert.equal((await app.inject({ method: 'POST', url: `${prefix}/suppliers`, ...multipart(payload) })).statusCode, 422);
  assert.equal((await app.inject({ method: 'POST', url: `${prefix}/suppliers`, ...multipart({ ...supplier(), status: 'approved' }) })).statusCode, 422);
});

test('spoofed and duplicate uploads fail without saving any records', async () => {
  for (const files of [
    [{ id: 'registration', bytes: Buffer.from('<script>not a PDF</script>') }],
    [{ id: 'registration' }, { id: 'registration' }],
    [{ id: 'unknown' }],
  ]) {
    const payload = supplier();
    const response = await app.inject({ method: 'POST', url: `${prefix}/suppliers`, ...multipart(payload, files) });
    assert.equal(response.statusCode, 422, response.body);
    assert.equal(await connection.db.collection('submissions').countDocuments({ registration: payload.details.registration }), 0);
  }
});

test('oversized files are rejected', async () => {
  const response = await app.inject({ method: 'POST', url: `${prefix}/suppliers`, ...multipart(supplier(), [{ id: 'registration', bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }]) });
  assert.equal(response.statusCode, 413, response.body);
});

test('service requests persist, normalize contacts, and replay the same receipt', async () => {
  const request = { method: 'POST' as const, url: `${prefix}/service-requests`, payload: service(), headers: { 'idempotency-key': randomUUID(), origin } };
  const first = await app.inject(request);
  assert.equal(first.statusCode, 201, first.body);
  assert.match(first.json().data.reference, /^SRV-/);
  const retry = await app.inject(request);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().data.reference, first.json().data.reference);
  const conflict = await app.inject({ ...request, payload: { ...request.payload, notes: 'changed' } });
  assert.equal(conflict.statusCode, 409, conflict.body);
  const stored = await connection.db.collection('submissions').findOne({ reference: first.json().data.reference });
  assert.equal(stored?.payload.phone, '+966501234567');
});

test('service invalid fields and missing idempotency keys are rejected', async () => {
  const response = await app.inject({ method: 'POST', url: `${prefix}/service-requests`, payload: { ...service(), name: ' ', phone: '+971501234567', email: 'invalid', serviceSlug: 'missing' }, headers: { 'idempotency-key': randomUUID() } });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.issues.length, 4);
  assert.equal((await app.inject({ method: 'POST', url: `${prefix}/service-requests`, payload: service() })).statusCode, 400);
});

test('origin allowlist and submission rate limits are enforced', async () => {
  const denied = await app.inject({ method: 'POST', url: `${prefix}/service-requests`, payload: service(), headers: { 'idempotency-key': randomUUID(), origin: 'https://untrusted.example' } });
  assert.equal(denied.statusCode, 403);
  const limited = await buildApp({ ...connection, origins: [origin], rateLimit: 1, logLevel: 'silent' });
  try {
    for (const expected of [201, 429]) {
      const response = await limited.inject({ method: 'POST', url: `${prefix}/service-requests`, payload: service(), headers: { 'idempotency-key': randomUUID() } });
      assert.equal(response.statusCode, expected, response.body);
    }
  } finally { await limited.close(); }
});
