# BSA intake backend — Node.js + MongoDB

This project serves supplier registration and service inquiries. It uses Fastify, TypeScript, the official MongoDB driver, Zod request parsing, and the frontend's pure validation/configuration modules. Existing remote project-request APIs are unchanged.

## Run locally

Requires Node.js 22.19+ and Docker Desktop, or a MongoDB replica set / Atlas deployment.

From the repository root:

```powershell
npm --prefix backend ci
Copy-Item backend/.env.example backend/.env
docker compose -f backend/compose.yaml up -d --wait
npm run dev:backend
```

In a second terminal:

```powershell
npm run dev
```

The API listens on `http://127.0.0.1:4000/api/intake/v1`; Vite proxies `/api/intake` there. The remaining `/api` proxy still points to the existing remote API. The frontend defaults to `/api/intake/v1`, so copying the root `.env.example` is optional. Production can use a same-origin reverse proxy or set `VITE_INTAKE_API_BASE_URL` at frontend build time.

For Atlas or an existing replica set, set `MONGODB_URI` and `MONGODB_DATABASE` in `backend/.env`, omit the Docker command, and run the backend. Do not put MongoDB credentials in `VITE_*` variables. A standalone `mongod` is intentionally rejected: supplier records and documents require transactions.

The supplied Compose file is **local development only**: one replica-set member, loopback port binding, no authentication. Use an authenticated TLS-enabled Atlas/replica-set deployment for production, with credentials restricted to the application database. The backend itself runs on the host in this local setup.

## Folder structure

```text
backend/
  src/
    server.ts                       # environment, Mongo connection, listen/shutdown
    app.ts                          # HTTP plugins, error handling, route composition
    config/env.ts                   # validated server-only settings
    common/
      errors.ts                     # consistent HTTP/field errors
      hash.ts                       # canonical request hashes
      idempotency.ts                # retry-key validation
    database/
      connection.ts                 # connection and migration runner
      models.ts                     # stored document/receipt types
      submission.repository.ts      # atomic persistence and uniqueness
      migrate.ts                    # migration CLI
      migrations/001-intake.ts       # collections, indexes, DB validators
    modules/
      suppliers/
        supplier.routes.ts          # HTTP/controller boundary and concurrency cap
        supplier.schema.ts          # strict wire-payload validation
        supplier.uploads.ts         # bounded multipart parsing and signatures
        supplier.service.ts         # normalization and registration rules
      service-requests/
        service-request.routes.ts
        service-request.schema.ts
        service-request.service.ts
      services/service.routes.ts    # catalog and service-detail reads
  tests/intake.test.ts               # real MongoDB replica-set integration tests
  compose.yaml                      # local MongoDB with persistent named volume
  Dockerfile                        # backend image; build from repository root
  .env.example
  API.md
```

Shared, dependency-free frontend/backend contracts stay in `lib/content/` and `lib/validation/`. Routes handle transport, services enforce business rules, and the repository owns MongoDB writes. Supplier and service records intentionally share the transaction/idempotency repository; file records are in a separate private collection. Deployments must include these shared `lib` files; the Dockerfile does so.

## Persistence and API behavior

- `submissions`: supplier/service payload, reference, pending-review status, timestamps, idempotency key and payload hash.
- `supplier_documents`: private BSON binary document bytes, original display name, detected MIME, SHA-256, optional expiry, and `unverified` status.
- `schema_migrations`: applied migrations. Startup applies unapplied migrations; `npm --prefix backend run db:migrate` also runs them explicitly. Add a new migration rather than editing an applied one.
- Unique MongoDB indexes enforce commercial-registration uniqueness and `(kind, idempotencyKey)` uniqueness. Submission and file inserts commit in one transaction. All file operations in a transaction are sequential.
- An unchanged retry returns the original receipt with HTTP 200. A new submission returns 201. Reusing a key for changed data returns 409. No email or notification delivery is claimed.
- The server recalculates completeness and revalidates required/conditional fields; it never accepts client-supplied approval or verification status.
- Multipart allows PDF/JPEG/PNG only, max 10 MiB per file and 40 MiB total, bounded part counts and JSON field size. Filename, MIME and signature are checked; filenames are never used as paths. No public upload/download/listing endpoints exist.
- Files are buffered within those limits and stored as individual MongoDB documents below the 16 MiB BSON limit. Up to three supplier uploads are processed concurrently per process. For higher volume, replace the storage adapter with quarantined object storage/GridFS and a streaming scanner.

Signature checks are not antivirus scanning or official certificate verification. Documents remain unverified. Add malware scanning and authenticated, authorized reviewer access before exposing documents to staff. Configure the actual retention/deletion policy, backups, TLS, privacy notice, and external identifier verification before public launch. The short frontend notice describes the implemented collection purpose; it does not substitute for the organization's approved full privacy policy.

## Configuration and operations

See `.env.example`. `CORS_ORIGINS` is a comma-separated exact-origin allowlist; unlisted browser origins are rejected. Submission rate limits default to 10 requests per minute per IP; other routes have a global 120/minute limit. These are per-process memory limits. Multi-instance deployments need a shared rate-limit store and shared ingress upload limits. `trustProxy` is false; configure only trusted proxy addresses in `app.ts` if deploying behind a proxy, otherwise clients share the proxy's IP limit. Never blindly trust forwarded headers from the public internet.

Logs omit request bodies, uploaded contents, credentials, and URL query strings. Database errors return generic messages and request IDs. `SIGINT`/`SIGTERM` close HTTP and Mongo connections. `/health` checks MongoDB connectivity. No administration UI or reviewer authentication system is included in these two public intake flows.

Build the backend image from the repository root:

```powershell
docker build -f backend/Dockerfile -t bsa-intake-api .
```

Pass server environment settings to the deployed container; its database must be reachable from the container. The local host-only MongoDB Compose settings are not a production multi-container topology.

## Checks

```powershell
npm --prefix backend run typecheck
npm run test:backend
npm run test:supplier
npx tsc --noEmit
npm run build
```

Backend tests start an isolated, real MongoDB replica set via `mongodb-memory-server`, use a random test database, and remove it afterward. The first run downloads MongoDB to `backend/node_modules/.cache/mongodb` (the Windows archive is large). Alternatively set `TEST_MONGODB_URI` to a test replica set; the tests still use a randomly named database and never target the configured application database. The test identity needs permission to create and drop that test database.

The existing root ESLint setup does not parse TS/TSX and includes old generated `.next` files; frontend/backend typechecks and integration tests are the relevant checks here.

Implementation references: [Fastify multipart limits](https://github.com/fastify/fastify-multipart), [MongoDB Node driver transactions](https://www.mongodb.com/docs/drivers/node/v6.x/crud/transactions/).
