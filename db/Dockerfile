FROM node:22-slim

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

# Workspace plumbing — manifest of every workspace so pnpm can
# compute the graph without the source trees.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY db/package.json ./db/
COPY dashboard/package.json ./dashboard/
COPY classifier/package.json ./classifier/

RUN pnpm install --filter @ai-job-classifier/db --frozen-lockfile

COPY db ./db
# Bake the bootstrap SQLite into the image so remote deploys without a
# host data mount still self-seed.
COPY data/seed ./data/seed

WORKDIR /app/db
ENV NODE_ENV=production
ENV SEED_DB_PATH=/app/data/seed/jobs.db
ENV IMPORT_FILE=/app/data/processed/merged-latest.json

CMD ["pnpm", "exec", "tsx", "src/seed/index.ts"]
