#!/bin/bash

# Configuration
BACKEND_PORT=8000
FRONTEND_PORT=3000

echo "🚀 Starting Meeting Co-Pilot..."

# Ensure we're in the project root
cd "$(dirname "$0")"

# 1. Start Backend in background
echo "📡 Starting Backend on port $BACKEND_PORT..."
cd backend
UV_CACHE_DIR=/tmp/uv_cache uv run uvicorn main:app --reload --port $BACKEND_PORT > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# 2. Wait for Backend
echo "⏳ Waiting for backend to start..."
sleep 2

# 3. Start Frontend in background
echo "🎨 Starting Frontend on port $FRONTEND_PORT..."
cd frontend
bun dev --port $FRONTEND_PORT > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

echo "✅ System started!"
echo "   - Backend: http://localhost:$BACKEND_PORT"
echo "   - Frontend: http://localhost:$FRONTEND_PORT"
echo "   - PIDs: Backend($BACKEND_PID), Frontend($FRONTEND_PID)"
echo "   - Logs: backend.log, frontend.log"
