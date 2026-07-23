# Repositório de Comunicações — backend

NestJS API backed at runtime by the Supabase Data API. Prisma is retained only
for schema generation and migrations. This service owns application data and
authorization; GBox remains the authentication provider.

## Data model

- `User`: minimal local profile linked through `gboxUserId`; no GBox password or
  access token is stored.
- `Role`, `Permission`, `UserRole`, `RolePermission`: local RBAC with seeded
  viewer, editor, publisher and administrator roles.
- `Communication`, `CommunicationVersion`, `CommunicationLocalization` and
  `CommunicationVariable`: channel templates, version lifecycle, translated
  content and template variables.
- `Category`: hierarchical taxonomy (category/subcategory).
- `Channel`, `Service`, `Team` and `Tag`: searchable communication metadata.
- `Favourite`: per-user saved communications.
- `AuditLog`: immutable application activity history.

All many-to-many relationships use explicit join tables so that they can be
extended later without a disruptive migration.

## Local setup

From the repository root, configure the backend `.env` from `.env.example`, then:

```bash
pnpm db:deploy
pnpm db:seed
pnpm dev
```

`db:deploy` applies committed migrations to Supabase and is the right command
for existing environments and CI. `DIRECT_URL` is migration-only. Runtime
NestJS endpoints do not instantiate Prisma or open PostgreSQL/Supavisor
connections; they use PostgREST through `SUPABASE_URL` and the backend-only
`SUPABASE_SECRET_KEY`. `DATABASE_URL` is retained only for Prisma CLI workflows
that require it and must not be used by deployed request handlers.

Useful commands:

```bash
pnpm db:migrate       # create and apply a development migration
pnpm db:deploy        # apply committed migrations
pnpm db:seed          # upsert base roles, permissions, channels and categories
pnpm db:studio        # inspect/edit local data using Prisma Studio
pnpm dev:backend      # run only the NestJS API on port 3001
```

To publish a frontend build version after deploying that build:

```bash
npm run app:version -- 1.0.1
```

Clients send their stored version in `X-Repositorio-App-Version`. A mismatch
returns HTTP `409` with `APP_VERSION_OUTDATED`, prompting the frontend to clear
its browser caches and reload with a versioned URL.

## Authentication integration contract

After GBox validates a login, upsert the local user by `gboxUserId` (or by
`username` during the transition), update `lastLoginAt`, and issue this API's own
short-lived session/JWT. Authorization must then use the locally assigned roles
and permissions. Never persist the GBox password or its access token in these
tables.

New users should receive the `viewer` role by default in the future auth service;
the seed intentionally does not create an administrator account.

## Supabase Data API

The global `SupabaseService` and API database adapter provide server-only
access to PostgREST and RPCs. Configure `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, and `SUPABASE_DB_SCHEMA` in the backend environment.
The configured Supabase region is `eu-west-1` (Ireland), colocated with the
Vercel `dub1` deployment region.

Check connectivity with:

```bash
curl http://localhost:3001/health/supabase
```

The secret key bypasses Row Level Security and must never be prefixed with
`NEXT_PUBLIC_`, returned by an endpoint, logged, or included in source control.
Browser access requires a separate Supabase publishable key and appropriate RLS
policies.

The Data API handles all deployed application reads and writes. Prisma uses a
database connection only in explicit migration, seed, import, and maintenance
commands outside request handling.

API responses include `Server-Timing` and `X-Data-Source: supabase-api` headers
so browser tooling shows total application time, Supabase API duration/call
count, and cache status for instrumented cached endpoints.

## Frontend integration

The browser uses only `NEXT_PUBLIC_BACKEND_API_BASE_URL`. NestJS exposes the
`/repo` endpoints and proxies GBox server-side using `GBOX_API_BASE_URL`. After a
successful GBox login, the backend synchronizes the minimal user profile into
Supabase and assigns the seeded `viewer` role on first login.

## Local-first GBox synchronization

Communication list and detail endpoints read exclusively from Supabase. They do
not contact GBox, so the repository remains available during a GBox outage.

An authenticated user can explicitly refresh the local copy with:

```bash
curl -X POST http://localhost:3001/repo/sync \
  -H "Authorization: Bearer <gbox-token>"
```

The full import upserts communications and channels, rebuilds versions,
localizations and variables, and synchronizes category, service, team and tag
relations. It then calls the separate GBox detail endpoint for every template
and language and persists pure HTML/text and PDF previews for offline display.
Missing remote communications are retained locally and marked
`UNAVAILABLE`; failed or empty responses never erase the last valid copy. Every
attempt is recorded in `sync_runs`.

For bootstrap/recovery, import the bundled GBox snapshot with:

```bash
pnpm db:import:gbox
```
