FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/tsconfig.json apps/server/tsup.config.ts ./apps/server/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html ./apps/web/
COPY packages/diff-engine/package.json packages/diff-engine/tsconfig.json packages/diff-engine/tsup.config.ts ./packages/diff-engine/
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
RUN pnpm build

FROM node:22-bookworm-slim AS server

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/reviews.db
WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/server/dist/index.js ./server/index.js
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server/index.js"]

FROM nginx:1.28-alpine AS web

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-qO-", "http://127.0.0.1:8080/api/health"]
