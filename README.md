# ai-job-classifier

End-to-end pipeline for scraping, classifying, and exploring AI/tech job listings on the German market. The runtime services are managed by `docker-compose.yml`:

- **dashboard** — Nuxt 4 + Tailwind 4 + Three.js UI on port 3000.
- **analytics** — private FastAPI + Pydantic AI service powering the authenticated Data Chat with read-only SQL.
- **postgres** — the single source of truth for runtime state.

One-off jobs (scrapers, merge/clean, the DeepSeek batched classifier) are invoked via the `Makefile` as `docker run --rm` against pre-built images.

## Quick start

```bash
cp .env.example .env
# fill in DEEPSEEK_API_KEY and a URL-safe CHAT_RO_PASSWORD (16+ characters).

docker compose build
make up
# postgres comes up → `seed` bootstraps from data/seed/jobs.db (3,613 jobs,
# 71 sub-segments, 74 tools, 80 company descriptions, plus join tables)
# → analytics + dashboard start.

open http://localhost:3000
curl -s http://localhost:3000/api/stats/overview | jq '.total'   # → 3613
```

A fresh deploy on any host with Docker installed produces the same populated dashboard — the seed SQLite is baked into the `db` image so no host-side data mount is required.

## Daily cycle

```bash
make daily
```

…which expands to:

1. `scrape-linkedin-cities` + `scrape-glassdoor-cities` → fresh JSON in `data/raw/`
2. `merge` → combines them into `data/processed/merged_jobs_<ts>.json` and refreshes the `merged-latest.json` symlink
3. `clean` → filters by AI/tech relevance
4. `import` → upserts into Postgres with `ON CONFLICT (source, source_id) DO UPDATE` (bumps `last_seen_at`; the `updated_at` trigger fires only when content actually changes)
5. `classify` → DeepSeek batched classifier re-derives `job_subcategories` + `job_tools`

After a daily run:

```bash
make psql
> SELECT count(*) FROM jobs WHERE first_seen_at::date = current_date;   -- truly new jobs
> SELECT count(*) FROM jobs WHERE last_seen_at::date  = current_date;   -- jobs re-confirmed today
```

## Data Chat

Signed-in users can open `/data-chat` and ask natural-language questions about
companies, tools, locations, and market trends. The private analytics service
uses DeepSeek and one SQL tool. Queries run as the dedicated `chat_ro` database
role in read-only transactions with a 10-second timeout and 200-row response cap.
That role has SELECT access only to the six job-analysis tables and cannot read
users, OAuth identities, passkeys, or CV data.

## Make targets

```text
make build                Build everything
make up                   Start compose services
make down                 Stop compose services
make logs                 Tail logs
make psql                 Open a psql shell against the running Postgres

make scrape-linkedin         ARGS="--pages 10"
make scrape-linkedin-cities  ARGS="--cities berlin,munich --pages 5"
make scrape-glassdoor        ARGS="--pages 10"
make scrape-glassdoor-cities ARGS="--cities berlin,munich --pages 5"
make merge                   ARGS="--linkedin data/raw/linkedin_cities_X.json --glassdoor data/raw/glassdoor_cities_X.json"
make clean                   ARGS="--input data/processed/merged_jobs_X.json --apply"

make import                  Upsert data/processed/merged-latest.json into Postgres
make discover                Re-discover sub-segments + tools (DeepSeek)
make classify                Classify all jobs into sub-segments + tools (DeepSeek)
make enrich                  Fetch German-language company descriptions for the top firms

make daily                   Full daily cycle (scrape → merge → clean → import → classify)
```

## Project layout

See [AGENTS.md](AGENTS.md) for the directory map. The short version:

- `db/` owns the Drizzle schema, migrations, and the SQLite→Postgres bootstrap.
- `dashboard/` is the Nuxt UI; its API routes talk to Postgres via `@ai-job-classifier/db`.
- `classifier/` is the TypeScript DeepSeek batch-classification pipeline.
- `analytics/` is the Python Pydantic AI service behind authenticated Data Chat.
- `scrapers/` is the Python (uv) package: LinkedIn, Glassdoor, merge, clean.
- `data/seed/jobs.db` is the committed bootstrap dataset — the source of truth for fresh deploys.

## Verifying the bootstrap

A fresh `docker compose up` runs migrations + reads `data/seed/jobs.db` and asserts the expected row counts before the dashboard is allowed to start:

```text
[seed] jobs                  expected= 3613 actual= 3613 ✓
[seed] subcategories         expected=   71 actual=   71 ✓
[seed] tools                 expected=   74 actual=   74 ✓
[seed] company_descriptions  expected=   80 actual=   80 ✓
[seed] job_subcategories     expected= 1085 actual= 1085 ✓
[seed] job_tools             expected= 1931 actual= 1931 ✓
[seed] bootstrap complete
```

If any count is wrong, the seed container exits non-zero and the dashboard never starts — the deploy fails loud instead of serving a half-loaded UI.
