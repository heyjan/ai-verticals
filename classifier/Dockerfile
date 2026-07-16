FROM node:22-slim

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

# Workspace plumbing — manifest of every workspace so pnpm can
# compute the graph without the source trees.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY db/package.json ./db/
COPY dashboard/package.json ./dashboard/
COPY classifier/package.json ./classifier/

RUN pnpm install --filter @ai-job-classifier/classifier... --frozen-lockfile

COPY db ./db
COPY classifier ./classifier

WORKDIR /app/classifier
ENV NODE_ENV=production
CMD ["pnpm", "exec", "tsx", "src/classify-jobs.ts"]
