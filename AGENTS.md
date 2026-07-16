# Agents

## Git workflow

- Always create a new branch for changes. Never commit directly to `main`.
- After a branch is merged, delete it.

## Security

- Never leave credentials, API keys, or secrets in source files.
- Never commit or push `.env` files.
- Never read `.env` files.

## Repo layout

This is a pnpm-workspace monorepo plus a Python package and a Postgres image:

| Path           | What                                                                                            |
|----------------|--------------------------------------------------------------------------------------------------|
| `db/`          | Drizzle schema + Postgres client (`@ai-job-classifier/db`). Owns migrations + the bootstrap seed.|
| `dashboard/`   | Nuxt 4 + Tailwind 4 + Three.js UI. Imports schema/client from `@ai-job-classifier/db`.           |
| `classifier/`  | TS pipeline service: DeepSeek-backed `discover-taxonomy`, `enrich-companies`, and batched `classify-jobs`. |
| `analytics/`   | Python 3.13 FastAPI + Pydantic AI service for authenticated, read-only Data Chat.                 |
| `scrapers/`    | Python (uv) LinkedIn + Glassdoor scrapers, merge, clean.                                         |
| `data/seed/`   | `jobs.db` — committed SQLite snapshot, the source of truth for bootstrapping a fresh Postgres.   |
| `data/raw/`    | Local scraper outputs (gitignored).                                                              |
| `data/processed/` | Local merge/clean outputs + `merged-latest.json` symlink consumed by `make import`.           |

## Tech stack

- **Database**: Postgres 17 (Drizzle ORM, `postgres` driver). The legacy sql.js / SQLite layer is gone — Postgres is the runtime DB; `data/seed/jobs.db` exists only as a bootstrap artifact.
- **Frontend**: Best practices for **Nuxt 4**, **Tailwind 4**, and **Three.js**. Always use the latest stable versions of all dependencies.
- **AI**:
  - DeepSeek (`openai` SDK against `https://api.deepseek.com`) for the batched taxonomy/classifier/enrichment scripts.
  - Pydantic AI analytics service owns the interactive Data Chat agent and its read-only SQL tool. Per-job agent loops are not how we classify in bulk.

## Audit columns

Every mutable table has `created_at` + `updated_at` (DEFAULT now(), `updated_at` maintained by a trigger that fires only when content actually changes). The `jobs` table additionally has `first_seen_at` and `last_seen_at` so we can answer "new jobs today" and "jobs that disappeared from the latest scrape" without bookkeeping.

`(source, source_id)` is a UNIQUE index on `jobs`; daily upserts use `ON CONFLICT (source, source_id) DO UPDATE` with `last_seen_at = now()` to make re-scrapes idempotent.

## Running things

- `make up` — start postgres + seed + analytics + dashboard.
- `make daily` — full daily cycle: scrape → merge → clean → import → classify.
- Per-step targets exist for everything (`make scrape-linkedin ARGS="--pages 10"`, `make discover`, `make psql`, etc.).
