# ai-job-classifier — top-level orchestration
#
# Long-running services (postgres, dashboard, classifier-agent) live in
# docker-compose. One-off jobs (scrapers, merge/clean, db import, the
# DeepSeek classifier pipeline) are invoked as `docker run --rm` against
# pre-built images so arg-passing stays clean.
#
# Container runtime is auto-detected: prefers `docker` if present, falls
# back to `podman` (with DOCKER_HOST set to the rootless podman socket
# and the `docker-compose` CLI plugin discovered from common locations).
# Override either via the environment: `make DOCKER=podman DC="podman compose" ...`

DOCKER               ?= $(shell command -v docker 2>/dev/null)
ifeq ($(DOCKER),)
  DOCKER             := $(shell command -v podman 2>/dev/null)
endif
ifeq ($(DOCKER),)
  $(error No container runtime found. Install docker or podman first.)
endif

# When using podman, route compose through the rootless socket so the
# docker-compose CLI plugin (or `podman compose`) can talk to it.
ifeq ($(notdir $(DOCKER)),podman)
  export DOCKER_HOST ?= unix:///run/user/$(shell id -u)/podman/podman.sock
  # Find a compose binary, in order of preference:
  #   1. docker-compose on PATH
  #   2. docker-compose CLI plugin in the user's ~/.docker/cli-plugins
  #   3. Fall back to `podman compose` (recent podman supports this)
  _PLUGIN_COMPOSE      := $(HOME)/.docker/cli-plugins/docker-compose
  DC                  ?= $(shell command -v docker-compose 2>/dev/null || (test -x $(_PLUGIN_COMPOSE) && echo $(_PLUGIN_COMPOSE)) || echo "podman compose")
else
  DC                  ?= $(DOCKER) compose
endif

PROJECT              := ai-job-classifier
COMPOSE_PROJECT      := $(notdir $(CURDIR))
PG_NETWORK           := $(COMPOSE_PROJECT)_default
PG_VOLUME            := $(COMPOSE_PROJECT)_pg-data

SCRAPERS_IMG         := $(PROJECT)-scrapers
CLASSIFIER_IMG       := $(PROJECT)-classifier
DB_IMG               := $(PROJECT)-db

# `:Z` relabels the bind-mounted host dir for SELinux (Fedora/podman);
# it's a no-op on docker engines without SELinux, so the same Makefile
# works on both local podman and the eventual remote docker host.
DATA_VOL             := -v $(CURDIR)/data:/app/data:Z
ENV_FILE             := --env-file .env

.PHONY: help doctor build build-scrapers build-classifier build-db build-compose \
        up down logs ps agent \
        scrape-linkedin scrape-linkedin-cities scrape-glassdoor scrape-glassdoor-cities \
        scrape-xing-cities linkedin-7days linkedin-24hours linkedin-daily xing-daily \
        merge dedup-train dedup-dbtest clean import xing-prune linkedin-prune discover categorize classify enrich daily \
        daily-attach daily-status daily-kill \
        psql

# Long-running targets are tmux-friendly: prefix the invocation with `BG=1`
# to detach into a tmux session named after the target so it survives SSH
# disconnects. Example: `BG=1 make classify` → session "classify".
TMUX_WRAP             = $(if $(BG),scripts/run-in-tmux.sh $@ ,)

doctor: ## Show the detected container runtime + compose binary
	@echo "DOCKER       = $(DOCKER)"
	@echo "DC           = $(DC)"
	@echo "DOCKER_HOST  = $${DOCKER_HOST:-(default)}"

help:
	@awk 'BEGIN { FS = ":.*##" } /^[a-zA-Z0-9_-]+:.*##/ { printf "  %-26s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ----- builds -----------------------------------------------------------

build: build-compose build-scrapers build-classifier build-db ## Build all images

build-compose: ## Build compose-managed services (postgres pulled)
	$(DC) build

build-scrapers: ## Build the scrapers image
	$(DOCKER) build -t $(SCRAPERS_IMG) -f scrapers/Dockerfile .

build-classifier: ## Build the classifier image (used for one-off discover/classify/enrich)
	$(DOCKER) build -t $(CLASSIFIER_IMG) -f classifier/Dockerfile .

build-db: ## Build the db image (used for one-off `make import`)
	$(DOCKER) build -t $(DB_IMG) -f db/Dockerfile .

# ----- compose lifecycle -----------------------------------------------

up: ## Start postgres + seed + dashboard + classifier-agent
	$(DC) up -d

down: ## Stop and remove containers (keeps volumes)
	$(DC) down

logs: ## Tail logs from all services
	$(DC) logs -f

ps: ## Show service status
	$(DC) ps

agent: ## Attach to the long-running pi.dev agent shell
	$(DC) attach classifier-agent

psql: ## Open a psql shell against the running Postgres
	$(DC) exec postgres psql -U $${POSTGRES_USER:-jobs} -d $${POSTGRES_DB:-jobs}

# ----- one-off scrape / merge / clean ----------------------------------

scrape-linkedin: ## Run LinkedIn scraper. Pass ARGS="--pages 10". Prefix `BG=1` to detach into tmux.
	$(TMUX_WRAP)$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.linkedin $(ARGS)

scrape-linkedin-cities: ## Run LinkedIn per-city scraper. ARGS="--cities berlin,munich --pages 5". `BG=1` to detach.
	$(TMUX_WRAP)$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.linkedin_cities $(ARGS)

linkedin-7days: ## Backfill: LinkedIn per-city scrape of jobs posted in the past 7 days. `BG=1` to detach.
	$(TMUX_WRAP)$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.linkedin_cities --since week $(ARGS)

linkedin-24hours: ## Daily (cron): LinkedIn per-city scrape of jobs posted in the past 24 hours. `BG=1` to detach.
	$(TMUX_WRAP)$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.linkedin_cities --since 24h $(ARGS)

linkedin-daily: ## Full LinkedIn 24h pipeline: scrape past 24h -> merge -> cross-DB dedup + import. `BG=1` to detach (cron-friendly).
	$(TMUX_WRAP)scripts/linkedin_daily.sh

xing-daily: ## Full Xing daily pipeline: incremental scrape (radius 20) -> merge -> clean -> import -> categorize. `BG=1` to detach (cron-friendly).
	$(TMUX_WRAP)scripts/xing_daily.sh

scrape-glassdoor: ## Run Glassdoor scraper. Pass ARGS="--pages 10". `BG=1` to detach into tmux.
	$(TMUX_WRAP)$(DOCKER) run --rm $(ENV_FILE) $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.glassdoor $(ARGS)

scrape-glassdoor-cities: ## Run Glassdoor per-city scraper. Reads GLASSDOOR_PROXY_URL from .env. `BG=1` to detach.
	$(TMUX_WRAP)$(DOCKER) run --rm $(ENV_FILE) $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.glassdoor_cities $(ARGS)

scrape-xing-cities: ## Run Xing per-city scraper (no auth required). `BG=1` to detach.
	$(TMUX_WRAP)$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.xing_cities $(ARGS)

scrape-all: ## Run LinkedIn + Glassdoor + Xing city scrapers in parallel. All default to TARGET_CITIES + Deutschland, --max-per-city 150.
	$(MAKE) -j3 --output-sync=line scrape-linkedin-cities scrape-glassdoor-cities scrape-xing-cities

scrape-status: ## Show live state of any in-progress scraper (one-shot)
	@python3 scripts/scrape_status.py

scrape-watch: ## Live-refreshing scrape status (Ctrl-C to exit)
	@watch -n 3 -t -c python3 scripts/scrape_status.py

merge: ## Merge LinkedIn + Glassdoor + Xing. ARGS="--linkedin ... --glassdoor ..."
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.merge $(ARGS)

# Corpus used for TF-IDF fit + description lookup when training the dedup
# model. Override with CORPUS=path; defaults to the labeled set's source.
CORPUS               ?= data/processed/merged_jobs_20260518_181222.json

dedup-train: ## Train the dedup ML model from labeled pairs → data/models/. Override CORPUS=path.
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.dedup.train \
	        --corpus $(CORPUS) \
	        --pairs data/processed/judge_pairs.json \
	        --labels data/processed/judge_labels.json \
	        --out data/models/dedup_model.joblib $(ARGS)

clean: ## Filter merged dataset by AI relevance. ARGS="--input ... [--apply]"
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.clean $(ARGS)

# Newest final LinkedIn city backfill (excludes the *_partial_ / *_log_ files).
NEW                  ?= $(shell ls -t data/raw/linkedin_cities_2*.json 2>/dev/null | head -1)

dedup-dbtest: ## Dry-run ML-dedup of the newest unmerged backfill (NEW=) against existing salaried DB jobs. No writes.
	@test -n "$(NEW)" || { echo "No backfill found; pass NEW=data/raw/...json"; exit 1; }
	@mkdir -p data/processed
	@echo "Exporting salaried DB jobs -> data/processed/db_salary_jobs.json"
	@$(DC) exec -T postgres psql -U $${POSTGRES_USER:-jobs} -d $${POSTGRES_DB:-jobs} -t -A \
	        -c "SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT source, source_id, title, company, location, city, description, salary, posted_date FROM jobs WHERE salary <> '') t" \
	        > data/processed/db_salary_jobs.json
	@echo "Comparing NEW=$(NEW) against the DB set..."
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.dedup_dbtest \
	        --new $(NEW) --existing data/processed/db_salary_jobs.json $(ARGS)

# ----- db + classifier one-offs (talk to the compose-managed Postgres) -

import: ## Cross-DB dedup the merged batch against the DB, then upsert (folds reposts into existing rows).
	@mkdir -p data/processed
	@echo "[import] exporting existing DB jobs for cross-DB dedup..."
	@$(DC) exec -T postgres psql -U $${POSTGRES_USER:-jobs} -d $${POSTGRES_DB:-jobs} -t -A \
	        -c "SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT id, source, source_id, title, company, city, location, description, salary, job_level, posted_ago, posted_date AS date_posted, contract_type, sector, url FROM jobs) t" \
	        > data/processed/db_existing.json
	@echo "[import] resolving new batch against existing rows..."
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.resolve_db \
	        --new data/processed/merged-latest.json \
	        --existing data/processed/db_existing.json \
	        --out data/processed/import-resolved.json
	$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) \
	        -e IMPORT_FILE=/app/data/processed/import-resolved.json $(DATA_VOL) $(DB_IMG) \
	        npx tsx src/import/from-json.ts

xing-prune: ## Soft-delete (active=false) Xing jobs whose listing was taken down (HTTP 410). Daily cron checks 1/7 (id%%7); full sweep weekly. ARGS="--shard-mod 0 --limit 50" to test all.
	@mkdir -p data/processed
	@echo "[xing-prune] exporting active Xing rows (id,url) from the DB..."
	@$(DC) exec -T postgres psql -U $${POSTGRES_USER:-jobs} -d $${POSTGRES_DB:-jobs} -t -A \
	        -c "SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT id, url, title, company FROM jobs WHERE source LIKE '%xing%' AND url <> '' AND active) t" \
	        > data/processed/xing-live.json
	@echo "[xing-prune] HEAD-checking today's shard for the not-available state..."
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.xing_prune \
	        --input data/processed/xing-live.json \
	        --output data/processed/xing-dead.json \
	        --shard-mod 7 $(ARGS)
	$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) \
	        -e PRUNE_FILE=/app/data/processed/xing-dead.json $(DATA_VOL) $(DB_IMG) \
	        npx tsx src/prune-jobs.ts

linkedin-prune: ## Soft-delete (active=false) LinkedIn jobs no longer accepting applications (apply CTA gone). Daily cron checks 1/7 (id%%7); full sweep weekly. ARGS="--shard-mod 0 --limit 50" to test all.
	@mkdir -p data/processed
	@echo "[linkedin-prune] exporting active LinkedIn rows (id,source_id,url) from the DB..."
	@$(DC) exec -T postgres psql -U $${POSTGRES_USER:-jobs} -d $${POSTGRES_DB:-jobs} -t -A \
	        -c "SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (SELECT id, source_id, url, title, company FROM jobs WHERE source LIKE 'linkedin%' AND url <> '' AND active) t" \
	        > data/processed/linkedin-live.json
	@echo "[linkedin-prune] GET-checking today's shard for the apply-CTA-gone state..."
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.linkedin_prune \
	        --input data/processed/linkedin-live.json \
	        --output data/processed/linkedin-dead.json \
	        --shard-mod 7 $(ARGS)
	$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) \
	        -e PRUNE_FILE=/app/data/processed/linkedin-dead.json $(DATA_VOL) $(DB_IMG) \
	        npx tsx src/prune-jobs.ts

discover: ## Re-discover sub-segments + tools via DeepSeek. `BG=1` to detach into tmux.
	$(TMUX_WRAP)$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) $(DATA_VOL) $(CLASSIFIER_IMG) \
	        npx tsx src/discover-taxonomy.ts

categorize: ## Assign top-level category to jobs landing as 'Other' via DeepSeek; drops non-AI listings. `BG=1` to detach.
	$(TMUX_WRAP)$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) $(DATA_VOL) $(CLASSIFIER_IMG) \
	        npx tsx src/categorize-jobs.ts

classify: ## Classify all jobs into sub-segments + tools (DeepSeek batch). `BG=1` to detach.
	$(TMUX_WRAP)$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) $(DATA_VOL) $(CLASSIFIER_IMG) \
	        npx tsx src/classify-jobs.ts

enrich: ## Fetch German-language company descriptions for the top firms. `BG=1` to detach.
	$(TMUX_WRAP)$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) $(DATA_VOL) $(CLASSIFIER_IMG) \
	        npx tsx src/enrich-companies.ts

# ----- daily cycle -----------------------------------------------------
#
# `make daily` spawns a detached tmux session 'ai-daily':
#   window 0 "scrape"   ─ split panes: linkedin │ glassdoor (run in parallel)
#   window 1 "pipeline" ─ waits for both, then merge → clean → import → categorize → classify
#
# Safe to disconnect SSH; reattach any time with `make daily-attach`.

daily: ## Full daily cycle in a detached tmux session (linkedin + glassdoor parallel)
	@scripts/daily.sh

daily-attach: ## Attach to the running daily tmux session
	@tmux attach -t ai-daily

daily-status: ## Show whether the daily tmux session is running, plus scrape progress
	@tmux has-session -t ai-daily 2>/dev/null \
	  && echo "ai-daily: running (tmux attach -t ai-daily)" \
	  || echo "ai-daily: not running"
	@python3 scripts/scrape_status.py || true

daily-kill: ## Kill the daily tmux session (does NOT stop already-running docker containers)
	@tmux kill-session -t ai-daily 2>/dev/null && echo "killed ai-daily" \
	  || echo "ai-daily not running"
