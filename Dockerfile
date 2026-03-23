FROM node:22-alpine AS builder

WORKDIR /app

# Enable npm workspaces
COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
COPY packages/web/package*.json ./packages/web/

# Install dependencies strictly
RUN npm ci

# Copy full source
COPY . .

# Build workspace (shared, server, web)
RUN npm run build

# Stage 2: Production
FROM node:22-alpine AS runner

WORKDIR /app

# Set environments
ENV NODE_ENV=production
ENV PORT=3000

# We need npm and npx locally for MCP shells to work smoothly
# node:22-alpine already includes npm, so we just retain it.

# Copy workspace roots
COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
COPY packages/web/package*.json ./packages/web/

# We still need prod deps for server runner
RUN npm ci --omit=dev

# Copy compiled backends and frontend dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/web/dist ./packages/web/dist
# Also need to copy schema exports/db or ensure production runs dist without TS.

# Expose HTTP
EXPOSE 3000

# Container entrypoint
CMD ["node", "packages/server/dist/index.js"]
