#!/bin/bash

# ======================================================
#  🎵 Miku Quizer - Double-Click Launcher for macOS
# ======================================================

# Move to the directory containing this script
cd "$(dirname "$0")"

echo "======================================================"
echo "  🎵 Miku Quizer - AI Backend Server"
echo "======================================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ [ERROR] Node.js is not installed or not in PATH!"
    echo "Please install Node.js from https://nodejs.org/"
    echo ""
    read -n 1 -s -r -p "Press any key to close..."
    exit 1
fi

echo "📦 [1/2] Checking dependencies (npm install in backend)..."
cd backend
npm install

echo ""
echo "🚀 [2/2] Starting Miku Quizer Backend Server..."
echo "======================================================"
echo "🌐 API Server: http://localhost:3001"
echo "🧪 Test Suite: http://localhost:3001/test"
echo "🧠 AI Model:   GPT-5.4 (OpenAI OAuth)"
echo "======================================================"
echo "Press Ctrl+C to stop the server anytime."
echo ""

node server.js

read -n 1 -s -r -p "Press any key to close..."
