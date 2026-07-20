# Repositório de Comunicações — backend

NestJS API backed by Supabase PostgreSQL and Prisma. This service owns application data and
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
for existing environments and CI. Use Supabase's direct connection for
`DIRECT_URL`; use the session/transaction pooler connection appropriate for the
deployed backend in `DATABASE_URL`.

Useful commands:

```bash
pnpm db:migrate       # create and apply a development migration
pnpm db:deploy        # apply committed migrations
pnpm db:seed          # upsert base roles, permissions, channels and categories
pnpm db:studio        # inspect/edit local data using Prisma Studio
pnpm dev:backend      # run only the NestJS API on port 3001
```

## Authentication integration contract

After GBox validates a login, upsert the local user by `gboxUserId` (or by
`username` during the transition), update `lastLoginAt`, and issue this API's own
short-lived session/JWT. Authorization must then use the locally assigned roles
and permissions. Never persist the GBox password or its access token in these
tables.

New users should receive the `viewer` role by default in the future auth service;
the seed intentionally does not create an administrator account.

## Supabase Data API

The global `SupabaseService` provides a server-only Supabase client for modules
that need Supabase Auth, Storage, Realtime or the generated Data API. Configure
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the backend `.env`. The optional
`SUPABASE_REGION` value is deployment metadata and is returned by the health
check; API routing itself uses the project URL.

Check connectivity with:

```bash
curl http://localhost:3001/health/supabase
```

The secret key bypasses Row Level Security and must never be prefixed with
`NEXT_PUBLIC_`, returned by an endpoint, logged, or included in source control.
Browser access requires a separate Supabase publishable key and appropriate RLS
policies.

The Data API client and Prisma serve different purposes: the Supabase client is
available for Auth, Storage, Realtime and PostgREST, while Prisma uses the
PostgreSQL connection for the application's relational data and migrations.

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
