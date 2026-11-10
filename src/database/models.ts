import type { Binary } from 'mongodb';

export type Receipt = { reference: string; status: 'pending_review'; submittedAt: string; completeness?: { completed: number; total: number; stars: number } };
export type SubmissionRecord = {
  _id: string; kind: 'supplier' | 'service'; reference: string; registration?: string;
  idempotencyKey: string; payloadHash: string; payload: unknown; receipt: Receipt;
  status: 'pending_review'; submittedAt: Date;
};
export type DocumentRecord = {
  _id: string; submissionId: string; documentType: string; originalName: string;
  mimeType: string; byteSize: number; sha256: string; expiryDate: string | null;
  verificationStatus: 'unverified'; content: Binary;
};
export type StoredDocument = { type: string; name: string; mime: string; bytes: Buffer; hash: string; expiry?: string };
