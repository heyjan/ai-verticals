FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Workspace plumbing — package.json of every workspace so npm can
# compute the graph without the source trees.
COPY package.json package-lock.json* ./
COPY db/package.json ./db/
COPY dashboard/package.json ./dashboard/
COPY classifier/package.json ./classifier/

RUN npm install \
        --workspace=@ai-job-classifier/db \
        --include-workspace-root=false \
        --no-audit --no-fund

COPY db ./db
# Bake the bootstrap SQLite into the image so remote deploys without a
# host data mount still self-seed.
COPY data/seed ./data/seed

WORKDIR /app/db
ENV NODE_ENV=production
ENV SEED_DB_PATH=/app/data/seed/jobs.db
ENV IMPORT_FILE=/app/data/processed/merged-latest.json

CMD ["npx", "tsx", "src/seed/index.ts"]
