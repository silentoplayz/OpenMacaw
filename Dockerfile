FROM node:20-alpine AS base
RUN apk add --no-cache libc-dev

FROM base AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY packages/server/package*.json packages/server/
COPY packages/web/package*.json packages/web/
RUN npm install

COPY packages/server packages/server
COPY packages/web packages/web
COPY tsconfig.json package.json ./

RUN npm run build

FROM base AS production
WORKDIR /app

# Copy compiled output from builder
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/web/dist packages/web/dist

# Copy node_modules from builder — all workspace deps are already installed there.
# Re-running npm install in production requires all workspace package.json files
# to be present; copying from builder is simpler and guaranteed correct.
COPY --from=builder /app/node_modules node_modules

# Copy package manifests so Node can resolve the workspace correctly at runtime
COPY package*.json ./
COPY packages/server/package.json packages/server/package.json

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
