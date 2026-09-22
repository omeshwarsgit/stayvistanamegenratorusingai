# ==============================================================================
# Production Dockerfile — OTA Property Name Generator (Optimized for Railway/Cloud)
# ==============================================================================
FROM node:20-bookworm-slim

# Install Python 3 and native openpyxl for fast, reliable batch processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-openpyxl \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node production dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source code
COPY . .

# Ensure storage directories exist with write permissions
RUN mkdir -p uploads output data

# Set production defaults (Railway overrides PORT dynamically at runtime)
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5178

# Default port exposure
EXPOSE 5178

# Start application server
CMD ["node", "server.js"]
