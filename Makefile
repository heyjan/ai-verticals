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
        merge clean import discover classify enrich daily \
        psql

doctor: ## Show the detected container runtime + compose binary
	@echo "DOCKER       = $(DOCKER)"
	@echo "DC           = $(DC)"
	@echo "DOCKER_HOST  = $${DOCKER_HOST:-(default)}"

help:
	@awk 'BEGIN { FS = ":.*##" } /^[a-zA-Z_-]+:.*##/ { printf "  %-26s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

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

scrape-linkedin: ## Run LinkedIn scraper. Pass ARGS="--pages 10".
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.linkedin $(ARGS)

scrape-linkedin-cities: ## Run LinkedIn per-city scraper. ARGS="--cities berlin,munich --pages 5"
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.linkedin_cities $(ARGS)

scrape-glassdoor: ## Run Glassdoor scraper. Pass ARGS="--pages 10".
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.glassdoor $(ARGS)

scrape-glassdoor-cities: ## Run Glassdoor per-city scraper.
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.glassdoor_cities $(ARGS)

scrape-all: ## Run LinkedIn + Glassdoor city scrapers in parallel. Both default to all TARGET_CITIES + the Deutschland country sweep, --max-per-city 200.
	$(MAKE) -j2 --output-sync=line scrape-linkedin-cities scrape-glassdoor-cities

scrape-status: ## Show live state of any in-progress scraper (one-shot)
	@python3 scripts/scrape_status.py

scrape-watch: ## Live-refreshing scrape status (Ctrl-C to exit)
	@watch -n 3 -t -c python3 scripts/scrape_status.py

merge: ## Merge LinkedIn + Glassdoor. ARGS="--linkedin ... --glassdoor ..."
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.merge $(ARGS)

clean: ## Filter merged dataset by AI relevance. ARGS="--input ... [--apply]"
	$(DOCKER) run --rm $(DATA_VOL) $(SCRAPERS_IMG) python -m scrapers.clean $(ARGS)

# ----- db + classifier one-offs (talk to the compose-managed Postgres) -

import: ## Upsert data/processed/merged-latest.json into Postgres
	$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) $(DATA_VOL) $(DB_IMG) \
	        npx tsx src/import/from-json.ts

discover: ## Re-discover sub-segments + tools via DeepSeek
	$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) $(DATA_VOL) $(CLASSIFIER_IMG) \
	        npx tsx src/discover-taxonomy.ts

classify: ## Classify all jobs into sub-segments + tools (DeepSeek batch)
	$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) $(DATA_VOL) $(CLASSIFIER_IMG) \
	        npx tsx src/classify-jobs.ts

enrich: ## Fetch German-language company descriptions for the top firms
	$(DOCKER) run --rm --network $(PG_NETWORK) $(ENV_FILE) $(DATA_VOL) $(CLASSIFIER_IMG) \
	        npx tsx src/enrich-companies.ts

# ----- daily cycle -----------------------------------------------------

daily: scrape-linkedin-cities scrape-glassdoor-cities merge clean import classify ## Full daily cycle
