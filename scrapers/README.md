# scrapers

LinkedIn + Glassdoor scrapers for the AI job classifier, plus the dedup/merge and dataset-cleaning utilities.

## Modules

| Module                    | What it does                                                                | Output                              |
|---------------------------|------------------------------------------------------------------------------|-------------------------------------|
| `scrapers.linkedin`       | LinkedIn Germany guest-API scraper (no login)                                | `data/raw/linkedin_jobs_*.json`     |
| `scrapers.linkedin_cities`| Per-city LinkedIn loops                                                      | `data/raw/linkedin_cities_*.json`   |
| `scrapers.glassdoor`      | Glassdoor Germany BFF-API scraper                                            | `data/raw/glassdoor_jobs_*.json`    |
| `scrapers.glassdoor_cities`| Per-city Glassdoor loops                                                    | `data/raw/glassdoor_cities_*.json`  |
| `scrapers.merge`          | Fuzzy dedup + merge of LinkedIn + Glassdoor → unified job records            | `data/processed/merged_jobs_*.json` + `merged-latest.json` symlink |
| `scrapers.clean`          | Filter merged dataset by AI/tech relevance                                   | `data/processed/merged_jobs_*.json` + `removed_jobs_*.json` |

## Local

```bash
uv sync
uv run python -m scrapers.linkedin --pages 10
```

## Docker

Built and invoked from the repo root via the top-level `Makefile`:

```bash
make build-scrapers
make scrape-linkedin       ARGS="--pages 10"
make scrape-linkedin-cities ARGS="--cities berlin,munich --pages 5"
make merge ARGS="--linkedin data/raw/linkedin_cities_LATEST.json --glassdoor data/raw/glassdoor_cities_LATEST.json"
make clean ARGS="--input data/processed/merged_jobs_LATEST.json --apply"
```

`merge` automatically updates `data/processed/merged-latest.json` (symlink) so the
db import step (`make import`) always reads the most recent dataset.
