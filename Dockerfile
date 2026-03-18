# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --production=false

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install production deps only
COPY package.json ./
RUN npm install --production && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Non-root user for security
RUN addgroup -S bridge && adduser -S bridge -G bridge

# Create writable data directory for bridge identity persistence
RUN mkdir -p /bridge-data && chown bridge:bridge /bridge-data

USER bridge

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
