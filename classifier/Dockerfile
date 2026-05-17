FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Workspace plumbing — package.json of every workspace so npm can
# compute the graph without the source trees.
COPY package.json package-lock.json* ./
COPY db/package.json ./db/
COPY dashboard/package.json ./dashboard/
COPY classifier/package.json ./classifier/

RUN npm install \
        --workspace=@ai-job-classifier/classifier \
        --include-workspace-root=false \
        --no-audit --no-fund

COPY db ./db
COPY classifier ./classifier

WORKDIR /app/classifier
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/interactive.ts"]
