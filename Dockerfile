# ==========================================
# Inkwell Production Dockerfile for Coolify
# ==========================================
# Debian slim (glibc) instead of Alpine (musl): Rollup's native musl parser
# runs with a small thread stack on Alpine and fails on react-dom with
# "Code is nested too deeply". The glibc build does not have that limit.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install exactly the versions in package-lock.json (reproducible builds).
# A plain `npm install` without the lockfile pulls whatever is newest and can
# break the build without any change in this repository.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source code
COPY . .

# Build Vite frontend
RUN npm run build

# ==========================================
# Production Runtime Stage
# ==========================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Copy dependencies and build artifacts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server
COPY --from=builder /app/index.html ./index.html
COPY --from=builder /app/vite.config.ts ./vite.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create directory for persistent local database storage (PGlite)
RUN mkdir -p /app/.data

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/.data

# Expose app port
EXPOSE 3000

# Volume for data persistence across Coolify container updates
VOLUME ["/app/.data"]

# Healthcheck with Node's built-in fetch (no curl needed in the image).
# The longer start period leaves time for tsx startup and database init.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the full-stack server
CMD ["npm", "start"]
