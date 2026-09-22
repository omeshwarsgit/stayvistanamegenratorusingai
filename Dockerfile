# ==============================================================================
# Production Dockerfile — OTA Property Name Generator
# ==============================================================================
FROM node:20-bullseye-slim

# Install Python 3, pip, and Chromium for headless rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    chromium \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Install Python dependencies for Excel & CSV batch processing
RUN pip3 install --no-cache-dir openpyxl

# Copy application source code
COPY . .

# Ensure storage directories exist with write permissions
RUN mkdir -p uploads output data

# Configure environment variables
ENV NODE_ENV=production
ENV PORT=5178
ENV HOST=0.0.0.0
ENV OTA_CHROME_PATH=/usr/bin/chromium

# Expose web server port
EXPOSE 5178

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "http.get('http://localhost:5178/api/status', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the application server
CMD ["node", "server.js"]
