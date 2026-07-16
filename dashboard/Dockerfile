FROM node:22-slim AS build

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Workspace plumbing — copy the manifest of every workspace so pnpm
# can compute the dependency graph without pulling the source trees.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY db/package.json ./db/
COPY dashboard/package.json ./dashboard/
COPY classifier/package.json ./classifier/

# Install only the dashboard workspace and its workspace deps (db).
RUN pnpm install --filter ai-job-dashboard... --frozen-lockfile

# Bring in the source for the two workspaces we actually need.
COPY db ./db
COPY dashboard ./dashboard

WORKDIR /app/dashboard
RUN pnpm run build

# Dereference the pnpm symlinks so the runtime stage gets real files.
RUN cp -rL node_modules/@fontsource /tmp/fontsource

FROM node:22-slim
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.13.1 --activate
# NB: use a bare manifest instead of `pnpm init` — pnpm's init writes a
# `packageManager: pnpm@^x.y.z` field (caret range) that corepack then
# rejects on the next command ("expected a semver version").
RUN echo '{"name":"dashboard-runtime","private":true}' > package.json \
    && pnpm add playwright@1.61.1 \
    && pnpm exec playwright install --with-deps chromium \
    && pnpm store prune
COPY --from=build /tmp/fontsource ./node_modules/@fontsource
COPY --from=build /app/dashboard/.output .output
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
