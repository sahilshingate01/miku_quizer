#!/usr/bin/env bash

# ======================================================
#  🎵 Miku Quizer - AI Backend Launcher (macOS / Linux)
# ======================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR/backend"

echo "======================================================"
echo "  🎵 Miku Quizer - AI Backend Launcher"
echo "======================================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ [ERROR] Node.js is not installed!"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "📦 [1/2] Checking & installing dependencies (npm install)..."
npm install

echo ""
echo "🚀 [2/2] Starting Miku Quizer Backend Server..."
echo "======================================================"
echo "🌐 API Endpoint: http://localhost:3001"
echo "🧪 Test Suite:   http://localhost:3001/test"
echo "======================================================"
echo ""

exec node server.js
