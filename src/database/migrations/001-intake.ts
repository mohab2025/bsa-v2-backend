import type { Db } from 'mongodb';

export const name = '001-intake';
export async function up(db: Db) {
  for (const collection of ['submissions', 'supplier_documents']) {
    if (!(await db.listCollections({ name: collection }).hasNext())) {
      try { await db.createCollection(collection); }
      catch (error) { if ((error as { code?: number }).code !== 48) throw error; }
    }
  }
  await db.collection('submissions').createIndexes([
    { key: { kind: 1, idempotencyKey: 1 }, unique: true, name: 'unique_submission_retry' },
    { key: { registration: 1 }, unique: true, partialFilterExpression: { registration: { $type: 'string' } }, name: 'unique_supplier_registration' },
    { key: { reference: 1 }, unique: true, name: 'unique_reference' },
    { key: { kind: 1, submittedAt: -1 }, name: 'submission_inbox' },
  ]);
  await db.collection('supplier_documents').createIndex({ submissionId: 1, documentType: 1 }, { unique: true, name: 'unique_supplier_document' });
  await db.command({ collMod: 'submissions', validator: { $jsonSchema: {
    bsonType: 'object', required: ['_id', 'kind', 'reference', 'idempotencyKey', 'payloadHash', 'payload', 'receipt', 'status', 'submittedAt'],
    properties: { _id: { bsonType: 'string' }, kind: { enum: ['supplier', 'service'] }, payload: { bsonType: 'object' }, receipt: { bsonType: 'object' }, status: { enum: ['pending_review', 'approved', 'rejected'] }, submittedAt: { bsonType: 'date' } },
  } } });
  await db.command({ collMod: 'supplier_documents', validator: { $jsonSchema: {
    bsonType: 'object', required: ['_id', 'submissionId', 'documentType', 'content', 'verificationStatus'],
    properties: { _id: { bsonType: 'string' }, submissionId: { bsonType: 'string' }, content: { bsonType: 'binData' }, verificationStatus: { enum: ['unverified', 'verified', 'rejected'] } },
  } } });
}
