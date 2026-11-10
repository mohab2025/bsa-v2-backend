import { initialSupplierDetails, supplierDocuments, type SupplierDetails, type SupplierDraft } from '../../../../lib/content/supplier-registration.ts';
import { activeSupplierFields, normalizeDigits, normalizeIdentifier, normalizeMobile, supplierCompleteness, validateSupplierDraft } from '../../../../lib/validation/supplier-registration.ts';
import { canonicalJson, sha256 } from '../../common/hash.ts';
import { HttpError } from '../../common/errors.ts';
import type { SubmissionRepository } from '../../database/submission.repository.ts';
import type { StoredDocument } from '../../database/models.ts';
import { supplierPayloadSchema } from './supplier.schema.ts';

export async function registerSupplier(repository: SubmissionRepository, payload: unknown, uploads: StoredDocument[], key: string) {
  const parsed = supplierPayloadSchema.parse(payload);
  const details: SupplierDetails = { ...initialSupplierDetails, ...parsed.details };
  details.registration = normalizeIdentifier(details.registration);
  details.taxNumber = normalizeIdentifier(details.taxNumber);
  details.iban = normalizeIdentifier(details.iban).toUpperCase();
  details.phone = normalizeMobile(details.phone);
  details.email = details.email.toLowerCase();
  details.tenderEmail = details.tenderEmail.toLowerCase();
  for (const field of ['employees', 'experience', 'establishmentYear'] as const) details[field] = normalizeDigits(details[field]);
  const draft: SupplierDraft = { ...parsed, details, files: {} };
  const activeKeys = new Set(activeSupplierFields(draft).map(field => field.key));
  for (const field of Object.keys(details) as (keyof SupplierDetails)[]) if (!activeKeys.has(field)) details[field] = '';
  // Only active selections and documents can enter the stored record.
  draft.subcategories = Object.fromEntries(Object.entries(draft.subcategories).filter(([category]) => draft.categories.includes(category)));
  const activeDocuments = supplierDocuments.filter(doc => !doc.visible || doc.visible(draft));
  for (const doc of uploads) {
    if (!activeDocuments.some(active => active.id === doc.type)) throw new HttpError(422, 'INAPPLICABLE_DOCUMENT', 'المستند لا ينطبق على بيانات المورد الحالية.');
    draft.files[doc.type] = new File([new Uint8Array(doc.bytes)], doc.name, { type: doc.mime });
  }
  draft.documentExpiry = Object.fromEntries(activeDocuments.filter(doc => doc.expiry && draft.files[doc.id] && draft.documentExpiry[doc.id]).map(doc => [doc.id, draft.documentExpiry[doc.id]]));
  const issues = validateSupplierDraft(draft);
  if (issues.length) throw new HttpError(422, 'VALIDATION_ERROR', 'يرجى استكمال أو تصحيح بيانات المورد.', issues);
  const documents = uploads.map(doc => ({ ...doc, expiry: draft.documentExpiry[doc.type] })).sort((a, b) => a.type.localeCompare(b.type));
  const stored = { details, types: draft.types.sort(), categories: draft.categories.sort(), subcategories: draft.subcategories,
    regions: draft.regions.sort(), documentExpiry: draft.documentExpiry, accurate: draft.accurate, authorized: draft.authorized, privacy: draft.privacy,
    privacyNoticeVersion: 'supplier-intake-v1',
  };
  const hash = sha256(canonicalJson({ payload: stored, documents: documents.map(doc => ({ type: doc.type, name: doc.name, hash: doc.hash })) }));
  return repository.create({ kind: 'supplier', key, hash, payload: stored, registration: details.registration, documents, completeness: supplierCompleteness(draft) });
}
