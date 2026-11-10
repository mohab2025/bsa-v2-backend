# API contract

Base path: `/api/intake/v1`.

## Read endpoints

- `GET /health` → `{ "status": "ok" }`, after a MongoDB ping.
- `GET /services` → `{ "data": [{ "slug": "...", "title": "...", "description": "...", "benefits": [], "features": [] }], "clientTypes": [] }`.
- `GET /services/:slug` → `{ "data": { "slug": "...", ...service } }`; unknown slug returns 404.

Catalog content uses the existing `lib/content/services.ts` source. Editing the catalog there changes the frontend and backend together.

## POST /service-requests

Content-Type: `application/json`. Required `Idempotency-Key` header: 16–100 letters, digits, hyphens or underscores (a UUID is recommended).

```json
{
  "name": "عميل الاختبار",
  "role": "مدير مشروع",
  "clientType": "شركة مقاولات",
  "phone": "0501234567",
  "email": "client@example.com",
  "serviceSlug": "project-management",
  "notes": "تفاصيل المشروع"
}
```

`name`, `clientType`, `phone`, `email` are required. `role`, `serviceSlug`, `notes` are optional. `clientType` must match the catalog list, and a nonempty `serviceSlug` must exist. Saudi local/international mobile formats and Arabic/Persian digits normalize to `+9665XXXXXXXX`. Text limits are 200 characters, or 4,000 for notes. JSON body limit: 32 KiB. Unknown properties are rejected.

## POST /suppliers

Content-Type: `multipart/form-data`. Same required `Idempotency-Key` header.

One field named `payload` contains JSON. File field names are the configured document IDs (`registration`, `profile`, `vat`, `engineering`, `contractor`, `license`, and optional document IDs in `lib/content/supplier-registration.ts`). Do not submit `files` inside the JSON. Only currently applicable uploads are sent.

Minimal non-regulated example, requiring `registration` and `profile` file parts:

```json
{
  "details": {
    "nameAr": "شركة الاختبار",
    "entityType": "شركة",
    "registration": "1010123456",
    "taxRegistered": "لا",
    "country": "المملكة العربية السعودية",
    "region": "مكة المكرمة",
    "city": "جدة",
    "address": "ABCD1234",
    "contact": "مسؤول التواصل",
    "role": "مدير",
    "phone": "0501234567",
    "email": "supplier@example.com",
    "description": "خدمات مساندة للمشروعات",
    "engineeringRegulated": "لا",
    "contractorRegulated": "لا",
    "specializedRegulated": "لا"
  },
  "types": ["support"],
  "categories": ["support"],
  "subcategories": {},
  "regions": ["مكة المكرمة"],
  "documentExpiry": {},
  "accurate": true,
  "authorized": true,
  "privacy": true
}
```

Optional detail fields default to blank. Country must be explicitly Saudi Arabia. Yes/no values currently follow the existing Arabic form (`نعم`, `لا`). Selected category subgroups and supplier-specific supply mode are checked using the same configuration as the frontend. VAT numbers/certificates and regulated-activity documents are conditional on the relevant declarations. This records applicant-declared applicability, not a legal determination.

Date values use `YYYY-MM-DD`. No expired-document rejection policy is invented. File sizes: 10 MiB each, 40 MiB total. JSON field: 128 KiB. Detail text fields: 4,000 characters maximum. Empty required values and invalid optional values both fail validation. Verification status, reference, score and timestamps are server-owned.

## Responses

New submission: HTTP 201. Retry of identical content with the same key: HTTP 200.

```json
{
  "data": {
    "reference": "SUP-20261110-012345ABCDEF",
    "status": "pending_review",
    "submittedAt": "2026-11-10T12:00:00.000Z",
    "completeness": { "completed": 25, "total": 55, "stars": 2.2727272727 }
  },
  "replayed": false
}
```

Service references start with `SRV-` and omit completeness. A receipt means the record committed to MongoDB, not supplier approval or notification delivery. Do not generate a new idempotency key merely because a request timed out; reuse it with unchanged content to retrieve the original receipt.

Errors use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "يرجى استكمال أو تصحيح بيانات المورد.",
    "issues": [{ "key": "document-vat", "step": 3, "message": "شهادة التسجيل في ضريبة القيمة المضافة: مستند مطلوب." }]
  },
  "requestId": "req-1"
}
```

`step` is zero-based and supplied for domain-level supplier issues. Schema errors may only have a key. Status codes: 400 malformed JSON/missing retry key, 403 denied browser origin, 404 unknown route/service, 409 duplicate supplier or changed retry payload, 413 size limit, 415 invalid content type, 422 invalid fields/files, 429 rate/capacity limit, 500 unexpected server error. Requests can be retried after correcting validation errors; generate a new key when content changes.
