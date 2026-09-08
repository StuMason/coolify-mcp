FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# OAuth state volume for HTTP mode (holds OAuth artefacts only — registered
# clients and token hashes — never a Coolify credential).
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node

# Environment variables (must be provided at runtime)
ENV COOLIFY_BASE_URL=""
ENV COOLIFY_ACCESS_TOKEN=""

# Default is the stdio server (unchanged behaviour for existing users).
# HTTP mode (#303): override the command with dist/http.js and set
# MCP_PUBLIC_URL — see docs/http-mode.md.
ENTRYPOINT ["node"]
CMD ["dist/index.js"]
