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

# Environment variables (must be provided at runtime)
ENV COOLIFY_BASE_URL=""
ENV COOLIFY_ACCESS_TOKEN=""

# Run the MCP server
ENTRYPOINT ["node", "dist/index.js"]