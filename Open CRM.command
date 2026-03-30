#!/bin/bash
# Diagonal Thinking CRM Launcher

PROJECT_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/01 Diagonal Thinking /Diagonal Admin/AI 2/Codex/diagonal-thinking-crm"

# Kill any existing processes on ports 3001 and 5173
lsof -ti:3001 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null

cd "$PROJECT_DIR"

# Start the local API server (port 3001)
node server.js &

# Start the Vite dev server (port 5173)
npm run dev &

# Wait for both servers to start
sleep 3

# Open in browser
open http://localhost:5173

LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")

echo "CRM is running at http://localhost:5173"
echo "Local API server running at http://localhost:3001"
echo ""
echo "Access from iPhone (same WiFi): http://${LOCAL_IP}:5173"
echo ""
echo "Close this window to stop both servers."
wait
