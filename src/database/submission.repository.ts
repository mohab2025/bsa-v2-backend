import { randomUUID, randomBytes } from 'node:crypto';
import { Binary, type MongoClient, type Db } from 'mongodb';
import { HttpError } from '../common/errors.ts';
import type { SubmissionRecord, DocumentRecord, Receipt, StoredDocument } from './models.ts';

type Submission = { kind: 'supplier' | 'service'; key: string; hash: string; payload: unknown; registration?: string; documents?: StoredDocument[]; completeness?: Receipt['completeness'] };

export class SubmissionRepository {
  private client: MongoClient;
  private db: Db;
  constructor(client: MongoClient, db: Db) { this.client = client; this.db = db; }

  async create(input: Submission): Promise<{ receipt: Receipt; replayed: boolean }> {
    const submissions = this.db.collection<SubmissionRecord>('submissions');
    const documents = this.db.collection<DocumentRecord>('supplier_documents');
    const identity = { kind: input.kind, idempotencyKey: input.key };
    const replay = (previous: SubmissionRecord) => {
      if (previous.payloadHash !== input.hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'تغيّرت بيانات الطلب. أعد المحاولة باستخدام طلب جديد.');
      return { receipt: previous.receipt, replayed: true };
    };
    const session = this.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const previous = await submissions.findOne(identity, { session });
        if (previous) return replay(previous);
        if (input.registration && await submissions.findOne({ registration: input.registration }, { session })) {
          throw new HttpError(409, 'SUPPLIER_EXISTS', 'يوجد طلب تسجيل لهذا السجل التجاري بالفعل.');
        }
        const id = randomUUID();
        const receipt: Receipt = {
          reference: `${input.kind === 'supplier' ? 'SUP' : 'SRV'}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(6).toString('hex').toUpperCase()}`,
          status: 'pending_review', submittedAt: new Date().toISOString(),
          ...(input.completeness ? { completeness: input.completeness } : {}),
        };
        await submissions.insertOne({
          _id: id, ...identity, reference: receipt.reference, ...(input.registration ? { registration: input.registration } : {}),
          payloadHash: input.hash, payload: input.payload, receipt, status: 'pending_review', submittedAt: new Date(receipt.submittedAt),
        }, { session });
        for (const doc of input.documents ?? []) {
          await documents.insertOne({ _id: randomUUID(), submissionId: id, documentType: doc.type, originalName: doc.name,
            mimeType: doc.mime, byteSize: doc.bytes.length, sha256: doc.hash, expiryDate: doc.expiry || null,
            verificationStatus: 'unverified', content: new Binary(doc.bytes),
          }, { session });
        }
        return { receipt, replayed: false };
      }, { writeConcern: { w: 'majority' }, readConcern: { level: 'snapshot' } });
      if (!result) throw new Error('Transaction did not return a receipt.');
      return result;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const previous = await submissions.findOne(identity);
        if (previous) return replay(previous);
        if (input.registration && await submissions.findOne({ registration: input.registration })) {
          throw new HttpError(409, 'SUPPLIER_EXISTS', 'يوجد طلب تسجيل لهذا السجل التجاري بالفعل.');
        }
      }
      throw error;
    } finally { await session.endSession(); }
  }
}
