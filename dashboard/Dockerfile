FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && \
    cp node_modules/sql.js/dist/sql-wasm.wasm .output/server/node_modules/sql.js/dist/

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/.output .output
# Copy data file for seeding
COPY --from=build /app/data ./data
ENV DATA_FILE_PATH=/app/data/merged_jobs_20260511_083938.json
ENV DATABASE_PATH=/app/.data/jobs.db
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
