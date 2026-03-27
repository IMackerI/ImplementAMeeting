#!/bin/bash
# Stop any process on port 8765
PORT=8765
PID=$(lsof -t -i:$PORT)
if [ -z "$PID" ]; then
    echo "No process found on port $PORT"
else
    echo "Killing process $PID on port $PORT"
    kill -9 $PID
fi

# Run the server via run.sh (which uses uvicorn with reload)
bash run.sh
