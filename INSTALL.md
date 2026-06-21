# Emby Playlist Manager - Installation Guide

## What You Need First
1. **Node.js** — Download from https://nodejs.org (choose the "LTS" version, it's the safe one)
2. **The Emby Playlist Manager folder** — You already have this

## Installation Steps

### Step 1: Install Node.js
- Go to https://nodejs.org
- Click the big green "LTS" button
- Run the installer like any normal program
- Click "Next" until it's done
- Restart your computer when it asks

### Step 2: Check Node.js Works
- Open Terminal (Mac) or Command Prompt (Windows)
- Type: `node --version`
- You should see a version number (like v18.0.0)
- If you see that, you're good ✓

### Step 3: Set Up the Playlist Manager
- Open Terminal/Command Prompt
- Type this (replace the path if yours is different):
```
cd "/Users/USER/Downloads/playlist manager"
```
- Press Enter

### Step 4: Install Dependencies
- Still in Terminal, type:
```
npm install
```
- This will download some files — it takes a minute or two, don't close it
- When it finishes, you'll see a prompt again ✓

### Step 5: Start the App
- Double click or right click open 
start-playlist-manager.sh
This will start th node.js terminal run the server.js and open the site. If site doesnt open, see below. 
```
- You should see some green text saying it's running
- Leave this window open

### Step 6: Open the App
- Open your web browser
- Go to: `http://localhost:5001`
- The app should load

## Done!
That's it. The app is now running.

**To stop it:** Press Ctrl+C in the Terminal window (or Cmd+C on Mac)

**To start it again next time:** Just run `node server.js` from the playlist manager folder

## Troubleshooting

**"command not found: node"** → Node.js didn't install. Download and run the installer again.

**"port 5001 already in use"** → Another copy is running. Find the Terminal window running it and press Ctrl+C, then try again.

**"npm: command not found"** → Node.js installer didn't work. Restart your computer and try again.

That's all. Enjoy!
