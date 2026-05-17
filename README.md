# ai-job-classifier

End-to-end pipeline for scraping, classifying, and exploring AI/tech job listings on the German market. Three services run side by side under one `docker-compose.yml`:

- **dashboard** — Nuxt 4 + Tailwind 4 + Three.js UI on port 3000.
- **classifier-agent** — long-running pi.dev session you can attach to and ask arbitrary questions about the dataset; the agent calls a `sql` custom tool against Postgres.
- **postgres** — the single source of truth for runtime state.

One-off jobs (scrapers, merge/clean, the DeepSeek batched classifier) are invoked via the `Makefile` as `docker run --rm` against pre-built images.

## Quick start

```bash
cp .env.example .env
# fill in DEEPSEEK_API_KEY (required for the classifier pipeline) and
# ANTHROPIC_API_KEY (required for the interactive pi.dev agent).

docker compose build
make up
# postgres comes up → `seed` bootstraps from data/seed/jobs.db (3,613 jobs,
# 71 sub-segments, 74 tools, 80 company descriptions, plus join tables)
# → dashboard + classifier-agent start.

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

## Interactive analysis agent

```bash
make agent
# attach to the classifier-agent container

> how many pytorch jobs in Berlin posted in the last 7 days?
[tool: sql] running...
[tool: sql] done

Based on the dataset, there are 14 jobs in Berlin mentioning pytorch
that were first seen in the past 7 days...
```

The agent has one custom tool (`sql`) that runs read-only queries against the same Postgres the dashboard reads from. It has no shell/file tools — it can only inspect the database.

## Make targets

```text
make build                Build everything
make up                   Start compose services
make down                 Stop compose services
make logs                 Tail logs
make psql                 Open a psql shell against the running Postgres
make agent                Attach to the long-running pi.dev agent

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
- `classifier/` is the TS pipeline service (DeepSeek + pi.dev).
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
