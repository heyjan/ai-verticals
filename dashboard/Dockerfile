FROM node:22-slim AS build

WORKDIR /app

# Workspace plumbing — copy the package.json of every workspace so npm
# can compute the dependency graph without pulling the source trees.
COPY package.json package-lock.json* ./
COPY db/package.json ./db/
COPY dashboard/package.json ./dashboard/
COPY classifier/package.json ./classifier/

# Install only the dashboard workspace (and its workspace dep, db).
RUN npm install \
        --workspace=ai-job-dashboard \
        --include-workspace-root=false \
        --include=dev \
        --no-audit --no-fund

# Bring in the source for the two workspaces we actually need.
COPY db ./db
COPY dashboard ./dashboard

WORKDIR /app/dashboard
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/dashboard/.output .output
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
