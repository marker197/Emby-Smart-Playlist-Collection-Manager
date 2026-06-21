#!/bin/bash

# MDBlists Curl Server + App Launcher
# This script starts the server and opens the app in your browser

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HTML_FILE="http://localhost:5001"
SERVER_FILE="$SCRIPT_DIR/server.js"

echo "🚀 Starting Playlist Manager Server..."

# Start the Node.js server in the background
node "$SERVER_FILE" &
SERVER_PID=$!

# Give server a moment to start
sleep 2

echo "📱 Opening app in browser..."

# Open the HTML file in the default browser
open "$HTML_FILE"

echo ""
echo "✅ Server running (PID: $SERVER_PID)"
echo "📝 To stop the server later, press Ctrl+C or run: kill $SERVER_PID"
echo ""

# Keep the server running
wait $SERVER_PID
