#!/usr/bin/env bash
# ==============================================================================
# START-MAC.command — Zero-Prerequisite Auto-Launcher for macOS
# ==============================================================================
# Double-click this file to launch the OTA Name Generator dashboard.
# It automatically configures portable runtimes and dependencies with no admin rights.

set -e

# Navigate to project root (handles paths with spaces safely)
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=================================================================="
echo "      OTA Property Name Generator — macOS Auto-Launcher          "
echo "=================================================================="

# ------------------------------------------------------------------------------
# [1/4] Check or Auto-Bootstrap Node.js Runtime (No Admin / Sudo Required)
# ------------------------------------------------------------------------------
NODE_CMD=""
NPM_CMD=""

if command -v node >/dev/null 2>&1; then
    NODE_CMD="node"
    NPM_CMD="npm"
    echo "[1/4] Using system Node.js ($(node -v))."
elif [ -f "$DIR/.runtime/node/bin/node" ]; then
    NODE_CMD="$DIR/.runtime/node/bin/node"
    NPM_CMD="$DIR/.runtime/node/bin/npm"
    export PATH="$DIR/.runtime/node/bin:$PATH"
    echo "[1/4] Using portable Node.js runtime ($("$NODE_CMD" -v))."
else
    echo "[1/4] Node.js not found on your system."
    echo "      Downloading portable standalone Node.js (no admin needed)..."
    mkdir -p "$DIR/.runtime"

    ARCH="$(uname -m)"
    if [ "$ARCH" = "arm64" ]; then
        NODE_DIST="node-v20.18.0-darwin-arm64"
    else
        NODE_DIST="node-v20.18.0-darwin-x64"
    fi

    NODE_TAR="$DIR/.runtime/node.tar.gz"
    curl -fsSL "https://nodejs.org/dist/v20.18.0/${NODE_DIST}.tar.gz" -o "$NODE_TAR"
    
    echo "      Extracting portable runtime..."
    tar -xzf "$NODE_TAR" -C "$DIR/.runtime"
    rm -f "$NODE_TAR"
    rm -rf "$DIR/.runtime/node"
    mv "$DIR/.runtime/${NODE_DIST}" "$DIR/.runtime/node"

    NODE_CMD="$DIR/.runtime/node/bin/node"
    NPM_CMD="$DIR/.runtime/node/bin/npm"
    export PATH="$DIR/.runtime/node/bin:$PATH"
    echo "      Portable Node.js installed successfully: $("$NODE_CMD" -v)"
fi

# ------------------------------------------------------------------------------
# [2/4] Check & Auto-Install Dependencies
# ------------------------------------------------------------------------------
if [ ! -d "$DIR/node_modules" ]; then
    echo "[2/4] Installing application dependencies (one-time setup)..."
    "$NPM_CMD" install --no-audit --no-fund
else
    echo "[2/4] Dependencies verified (node_modules ready)."
fi

# Optional: Ensure python openpyxl is ready if python3 is present for batch jobs
if command -v python3 >/dev/null 2>&1; then
    python3 -c "import openpyxl" 2>/dev/null || python3 -m pip install openpyxl --quiet 2>/dev/null || true
fi

# ------------------------------------------------------------------------------
# [3/4] Port Management & Safeguards
# ------------------------------------------------------------------------------
PORT="${PORT:-5178}"
URL="http://localhost:$PORT"

if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[3/4] Application is ALREADY RUNNING on port $PORT."
    echo "      Opening browser and exiting cleanly..."
    open "$URL"
    exit 0
fi

echo "[3/4] Port $PORT is available."

# ------------------------------------------------------------------------------
# [4/4] Launch Application & Open Browser
# ------------------------------------------------------------------------------
echo "[4/4] Launching OTA Name Generator..."
echo "------------------------------------------------------------------"
echo "  Local Dashboard: $URL"
echo "  Keep this terminal window open while using the application."
echo "  To stop: Press Ctrl + C or close this window."
echo "------------------------------------------------------------------"

# Open default browser after a short pause
(sleep 1.2 && open "$URL") &

# Run server
exec "$NODE_CMD" server.js
