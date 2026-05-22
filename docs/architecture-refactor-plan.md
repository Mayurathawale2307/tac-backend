# TAC Architecture Refactor Plan

## Current Stack

- Frontend: Next.js App Router, React 19, TypeScript, Tailwind CSS v4, Base UI, Recharts
- Backend: Node.js, Express 5, TypeScript
- Data: PostgreSQL, Prisma
- Auth: Custom signed cookie session plus Google OAuth

## Current State Summary

The repo already has a useful separation between `tac-frontend` and `tac-backend`, but both apps are still organized more like an early-stage project than a production-grade system:

- Frontend code is mostly split by technical layer (`components`, `lib`, `hooks`) instead of by product feature.
- Business logic, data fetching, state, transformations, and UI are mixed inside large client components.
- API client logic is duplicated across `auth-client.ts`, `tac-client.ts`, and `team-client.ts`.
- Backend uses controllers as the main place for validation, authorization, data access, and response shaping.
- Routing is mixed on the frontend: App Router is primary, but a legacy `pages/` directory still exists.
- Environment loading, auth, error handling, and logging are functional but not yet standardized for scale.

## Target Architecture

Use a two-application repo with feature-first internals and thin composition layers.

```text
Tac/
  apps/
    web/
      src/
        app/
          (marketing)/
          (auth)/
            login/
          (dashboard)/
            layout.tsx
            dashboard/
            api-keys/
            messages/
            teams/
          api/
        features/
          auth/
            api/
            components/
            hooks/
            schemas/
            types/
            utils/
          api-keys/
            api/
            components/
            hooks/
            mappers/
            schemas/
            types/
          messages/
            api/
            components/
            hooks/
            mappers/
            types/
          teams/
            api/
            components/
            hooks/
            schemas/
            types/
          dashboard/
            components/
            hooks/
            types/
        shared/
          components/
            layout/
            ui/
          config/
          constants/
          hooks/
          lib/
            api/
            env/
            formatters/
            utils/
          providers/
          stores/
          types/
        styles/
        tests/
          unit/
          integration/
          e2e/
      public/
    api/
      src/
        app/
          server.ts
          routes.ts
        modules/
          auth/
            auth.controller.ts
            auth.service.ts
            auth.repository.ts
            auth.schema.ts
            auth.mapper.ts
            auth.types.ts
            auth.routes.ts
          api-keys/
            api-keys.controller.ts
            api-keys.service.ts
            api-keys.repository.ts
            api-keys.schema.ts
            api-keys.mapper.ts
            api-keys.types.ts
            api-keys.routes.ts
          messages/
            public-message.controller.ts
            public-message.service.ts
            public-message.repository.ts
            public-message.schema.ts
            public-message.mapper.ts
            public-message.routes.ts
          teams/
            teams.controller.ts
            teams.service.ts
            teams.repository.ts
            teams.schema.ts
            teams.mapper.ts
            teams.types.ts
            teams.routes.ts
        shared/
          config/
          database/
          errors/
          lib/
          logger/
          middleware/
          security/
          types/
          utils/
          validations/
        jobs/
        tests/
          unit/
          integration/
          contract/
      prisma/
        schema.prisma
        migrations/
        seed.ts
  docs/
    architecture/
```

## Why Each Folder Exists

- `app/`: route composition only. Keep it thin. It should assemble feature modules, not contain feature logic.
- `features/`: the default home for product logic. Every business capability lives here first.
- `shared/`: only truly cross-feature code belongs here.
- `shared/lib/api/`: one reusable HTTP client, request helpers, auth handling, retry policy, and error normalization.
- `shared/components/ui/`: design-system primitives only.
- `shared/components/layout/`: shell, sidebar, topbar, providers, page wrappers.
- `modules/` on the backend: each domain owns its controller, service, repository, validation, and response mapping.
- `shared/database/`: Prisma client, transaction helpers, query utilities.
- `shared/security/`: auth helpers, cookie/session policy, permissions, rate limiting, security headers.
- `shared/errors/`: typed app errors, error codes, centralized HTTP mapping.
- `tests/`: test code lives near the app boundary, not mixed into runtime folders.

## Rules

### Frontend

- Put code in a feature folder by default.
- Move code to `shared/` only after at least two features use it.
- Never let `app/` import raw fetch logic directly.
- Keep server concerns in server components where possible.
- Keep client components small and interaction-focused.

### Backend

- Controllers parse input and return HTTP responses only.
- Services hold business rules.
- Repositories own Prisma queries.
- Validation must be schema-based, not ad hoc `typeof` checks.
- Shared middleware must not contain module-specific policy.

## Naming Rules

- Use plural route/module names for resources: `api-keys`, `messages`, `teams`.
- Use `PascalCase` for React components and `kebab-case` for folders.
- Use `*.schema.ts`, `*.service.ts`, `*.repository.ts`, `*.mapper.ts`, `*.types.ts`.
- Use action-based names for hooks: `use-current-user`, `use-message-feeds`, `use-team-members`.
- Use `dto` only at external boundaries. Prefer `payload`, `input`, `result`, or `response` internally.

## Import Rules

- `app/*` may import from `features/*` and `shared/*`.
- `features/<feature>` may import from its own files and `shared/*`.
- Cross-feature imports must go through a feature public barrel such as `features/messages/index.ts`.
- `shared/*` must never import from `features/*`.
- Backend modules must not import another module's repository directly. Share only contracts or public services.

## Frontend Refactor Priorities

1. Replace `lib/auth-client.ts`, `lib/tac-client.ts`, and `lib/team-client.ts` with one shared API client plus feature-specific API adapters.
2. Split large files:
   - `components/api-keys-section.tsx`
   - `app/messages/page.tsx`
   - `components/team-management.tsx`
   - `components/teams-section.tsx`
3. Move auth gating out of `AppShell` and into App Router server layout plus middleware.
4. Convert route pages into thin composition files.
5. Move route-specific UI into `features/*/components`.

## Backend Refactor Priorities

1. Break controllers into module service and repository layers.
2. Introduce request validation with Zod.
3. Add a centralized error model with `AppError`.
4. Add request IDs, structured logging, and audit events.
5. Separate public message ingestion from dashboard message querying as distinct modules.

## Database Recommendations

- Keep Prisma schema in `apps/api/prisma/`.
- Use migrations, not only `db push`.
- Add seed data for local onboarding.
- Add retention strategy for `Message` data.
- Add indexes for the hottest read paths:
  - `ApiKey(userId, status, createdAt)`
  - `ApiKey(teamId, status, createdAt)`
  - `Message(apiKeyId, receivedAt)`
  - `TeamMember(teamId, role)`
- Consider soft delete for `Team` and `ApiKey` if auditability matters.

## Security Recommendations

- Add rate limiting to the public message submission endpoint.
- Add schema validation and email normalization before persistence.
- Add bot protection for public submissions.
- Replace handwritten session handling with hardened session infrastructure or add secret rotation and cookie prefixing.
- Add `helmet`, trusted proxy config, request size limits, and consistent CORS policy.
- Add RBAC helpers for owner/admin/member checks.

## Performance Recommendations

- Do not fetch full message history for every API key in a list endpoint.
- Split message summary and message detail endpoints.
- Paginate message records.
- Lazy-load analytics and heavy chart/table modules.
- Use server components for authenticated page bootstrap where possible.
- Add caching and SWR/TanStack Query style data orchestration once the API layer is normalized.

## Team Scale Recommendations

- Add workspace tooling at the repo root when ready:
  - shared ESLint config
  - shared TypeScript base config
  - shared Prettier config
  - CI pipelines for lint, typecheck, test, and build
- Define feature ownership by folder.
- Export only public module APIs through index files at the module boundary.
- Keep code review scopes aligned with feature folders.

## Anti-Patterns To Remove

- Root-level dumping folders that mix unrelated domain logic.
- Large UI files that also fetch and transform data.
- Controllers that contain authorization, validation, query composition, and serialization together.
- Duplicate fetch wrappers and response normalization code.
- Legacy router artifacts that stay in the build without adding value.
- Placeholder or dead dependencies that imply architecture you are not actually using.

## Suggested Phased Roadmap

### Phase 1: Foundation

- Remove unused routing leftovers.
- Fix incorrect scripts and path inconsistencies.
- Introduce shared frontend API client.
- Add backend validation and error primitives.

### Phase 2: Feature Extraction

- Move auth, api-keys, messages, teams, and dashboard into feature folders.
- Split oversized components into page, container, and presentational parts.
- Introduce backend services and repositories per module.

### Phase 3: Platform Hardening

- Add tests, logging, rate limiting, metrics, and deployment config.
- Add migrations, seeding, and local dev scripts.
- Add CI and environment contracts.

### Phase 4: Scale Readiness

- Add async jobs for email/webhook processing.
- Add read-optimized endpoints and caching.
- Add observability, audit trails, and background data retention jobs.
