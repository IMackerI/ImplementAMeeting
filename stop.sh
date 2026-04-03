#!/bin/bash

# Configuration
BACKEND_PORT=8000
FRONTEND_PORT=3000

echo "🛑 Stopping Meeting Co-Pilot..."

# Ensure we're in the project root
cd "$(dirname "$0")"

# 1. Kill any existing processes on port 8000 (Backend)
echo "🧹 Releasing port $BACKEND_PORT..."
fuser -k $BACKEND_PORT/tcp > /dev/null 2>&1
pkill -f "uvicorn main:app" > /dev/null 2>&1

# 2. Kill any existing processes on port 3000 (Frontend)
echo "🧹 Releasing port $FRONTEND_PORT..."
fuser -k $FRONTEND_PORT/tcp > /dev/null 2>&1
pkill -f "next-dev" > /dev/null 2>&1
pkill -f "bun dev" > /dev/null 2>&1

echo "✅ System stopped!"
