FROM node:20-alpine

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

# Copy package files first (better layer caching)
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY bin.mjs ./
COPY src/ ./src/

# Remove build tools to reduce image size
RUN apk del python3 make g++ gcc

# Data volume
VOLUME /data

# Default environment
ENV DATA_DIR=/data
ENV PORT=3100
ENV HOST=0.0.0.0

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3100/health || exit 1

CMD ["node", "bin.mjs"]
