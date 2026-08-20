# ==========================================
# Inkwell Production Dockerfile for Coolify
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install system dependencies if needed
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build Vite frontend
RUN npm run build

# ==========================================
# Production Runtime Stage
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install curl for Coolify healthchecks
RUN apk add --no-cache curl

# Copy dependencies and build artifacts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/index.html ./index.html
COPY --from=builder /app/vite.config.ts ./vite.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create directory for persistent local database storage (PGlite)
RUN mkdir -p /app/.data

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Expose app port
EXPOSE 3000

# Volume for data persistence across Coolify container updates
VOLUME ["/app/.data"]

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the full-stack server
CMD ["npm", "start"]
