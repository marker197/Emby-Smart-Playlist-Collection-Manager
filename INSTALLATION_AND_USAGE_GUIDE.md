# Emby Playlist Manager - Complete Installation & Usage Guide

**Version:** 1.0.0  
**Date:** June 2026  
**Platform:** macOS (Node.js backend on port 5001)

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Server Startup](#server-startup)
5. [External Service Setup](#external-service-setup)
6. [Using the Smart Playlist Generator](#using-the-smart-playlist-generator)
7. [Using the Chronological Playlist Generator](#using-the-chronological-playlist-generator)
8. [Troubleshooting](#troubleshooting)

---

## Installation & Setup


The Simple Setup Guide includes:
- Installing Node.js
- Downloading the app from GitHub
- Installing dependencies
- Configuring the .env file
- Starting the app

---

## Configuration

### Step 1: Edit the `.env` File

The `.env` file contains all sensitive configuration. **Never commit this to version control.**

#### Location
```
~/emby-playlist-manager/.env
```

#### Example `.env` File

```env
# ═══════════════════════════════════════════
# EMBY CONFIGURATION
# ═══════════════════════════════════════════

# Emby server URL (internal network address)
EMBY_URL=http://192.168.1.90:8096

# Emby API token (get from Emby settings > API keys)
EMBY_TOKEN=your_emby_api_token_here

# Emby User ID (from Emby settings)
EMBY_USER_ID=your_user_id_here


# ═══════════════════════════════════════════
# SERVER SETTINGS
# ═══════════════════════════════════════════

# Node.js server port
PORT=5001

# Environment (development or production)
NODE_ENV=development

# Frontend URL (where the HTML is served from)
FRONTEND_URL=http://localhost:3000


### Step 2: Get Emby API Token

1. **Open Emby:** `http://<your-emby-ip>:8096`
2. Go to **Settings > Advanced > API Keys**
3. Create a new API key (or use existing)
4. Copy the token and paste into `.env` as `EMBY_TOKEN`

### Step 3: Get Emby User ID

1. Open Emby settings
2. Look for User ID in **Settings > Users**
3. Copy and paste into `.env` as `EMBY_USER_ID`

---

## Starting the App

**To start the app, see:** `SIMPLE_SETUP_GUIDE.md` - Step 4

The Simple Setup Guide shows you how to easily start the backend and frontend with one double-click using the `start-playlist-manager.sh` script.

---

## External Service Setup

### 1. Trakt Integration (for Chronological Playlists)

#### What is Trakt?
Trakt tracks movies/shows you watch and maintains watchlists.

#### Setup Steps

1. **Create a Trakt Account**
   - Visit [trakt.tv](https://trakt.tv)
   - Sign up or log in

2. **Create an API Application**
   - Go to [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications)
   - Click "New Application"
   - Fill in:
     - **Name:** "Emby Playlist Manager"
     - **Redirect URL:** `urn:ietf:wg:oauth:2.0:oob`
   - Accept terms and create
   - Copy **Client ID** and **Client Secret**

3. **In the App**
   - Go to **Settings** tab > External Services
   - Paste your Trakt credentials
   - Click "Connect to Trakt"

#### Using Trakt in the App
- **Chronological Tab > Load Watchlist**
- Select your Trakt watchlist
- App will fetch all items in order
- Create chronological collection from results

---

### 2. MDBlists Integration (for Curated Lists)

#### What is MDBlists?
MDBlists provides curated movie/show lists via API.

#### Setup Steps

1. **Create MDBlists Account**
   - Visit [mdblist.com](https://mdblist.com)
   - Sign up or log in

2. **Create an App**
   - Go to [https://mdblist.com/developer/](https://mdblist.com/developer/)
   - Fill in your application details
   - Set Callback URL to: `http://localhost:9999/callback`
   - Create the app
   - Copy your **Client ID**

3. **In the App**
   - Go to **Chronological Tab > MDBlists Section**
   - Enter your Client ID in settings
   - Follow the instructions exactly in the mdblists settings once you have entered the client id

#### Popular MDBlists Collections
- IMDB Top 250
- Rotten Tomatoes Best Reviewed
- Criterion Collection
- User-created curated lists

#### Using MDBlists in the App
1. Click "Load User Lists" or "Load Liked Lists"
2. Select a list from dropdown
3. Click "Load Items"
4. Review and create collection

---

## Using the Smart Playlist Generator

### Overview
The Smart Playlist Generator creates dynamic playlists based on rules (genre, rating, year, etc.) and runs them on a schedule.

### Tab 1: Dashboard

**Left Panel - Recent Activity**
- Shows last 5 playlist executions
- Includes execution time, items added, success/fail status
- Click on entry to see full details

**Right Panel - Next Scheduled Runs**
- Shows next 5 scheduled playlists
- Displays when each will run next
- Quick links to run immediately or edit

### Tab 2: Rules

**Left Panel - Create New Rule**

1. **Rule Name:** Give it a descriptive name
   - Example: "Recently Released Action Movies"

2. **Rule Type:** Choose how items are selected
   - **Match All (AND):** Item must match ALL conditions
   - **Match Any (OR):** Item must match ANY conditions
   - **Exclude (NOT):** Item must NOT match conditions

3. **Conditions:** Add filters
   - Click "Add Condition"
   - Select filter type:
     - **Genre** → Select movie/TV genre
     - **Year Released** → Specify year range
     - **Rating** → IMDB/User rating threshold
     - **Collection** → Filter by Emby collection
   - Operator (is, is not, greater than, etc.)
   - Value

4. **Example Rule:**
   ```
   Name: "Recent 4K Action Movies"
   Type: Match All (AND)
   Conditions:
   - Genre is "Action"
   - Year Released is greater than 2020
   - Resolution is "4K"
   ```

5. **Save Rule**
   - Click "Save Rule"
   - Appears in right panel

**Right Panel - Saved Rules**
- Lists all your custom rules
- Edit: Click rule, modify conditions, click Save
- Delete: Click trash icon (confirm deletion)
- Drag to reorder (if needed)

### Tab 3: Schedules

**Left Panel - Create New Schedule**

1. **Select Rule**
   - Dropdown menu with all saved rules
   - Choose the rule to run

2. **Playlist Name**
   - Name for the generated playlist
   - Example: "Weekly Action Pick"

3. **Schedule Frequency**
   - **Daily:** Every day at midnight
   - **Weekly:** Every Monday at midnight
   - **Biweekly:** Every other week
   - **Monthly:** First day of month
   - **Custom:** Define your own schedule

4. **Notification Email** (Optional)
   - Add email address to receive completion notifications
   - Leave blank to disable

5. **Description** (Optional)
   - Notes about this playlist

6. **Create Schedule**
   - Click "Create Schedule"
   - Playlist will be created automatically per schedule

**Right Panel - Scheduled Playlists**
- Lists all active schedules
- Shows next run time
- Toggle on/off without deleting
- Edit: Click to modify schedule
- Run Now: Execute immediately without waiting
- Delete: Permanently remove schedule

### Example Workflow

```
1. Create Rule: "Recent Horror Movies"
   - Genre: Horror
   - Year: 2020+

2. Create Schedule: "Weekly Horror"
   - Uses "Recent Horror Movies" rule
   - Runs every Monday at midnight
   - Creates "New Horror" playlist
   - Send notification to email@example.com

3. Monday midnight arrives:
   - Backend finds all horror movies from 2020+
   - Creates/updates "New Horror" playlist in Emby
   - Sorts by release date (newest first)
   - Sends completion email
   - Dashboard shows execution
```

### Tab 4: Templates

Pre-built rule templates for common scenarios:

- **New Releases:** Movies/shows from last 30 days
- **Top Rated:** Items with rating > 8.0
- **By Director:** Filter by specific director
- **Award Winners:** Oscar/Golden Globe winners
- **4K/HD:** High-resolution video content
- **Recently Added to Emby:** Items added to library recently

**Using a Template:**
1. Click template card
2. Edit conditions if desired
3. Click "Use This Template"
4. Rule is created and ready to schedule

### Tab 5: Settings

**Left Panel - Emby Connection**
- Emby URL: `http://192.168.1.90:8096` (or your IP)
- API Token: Your Emby API key
- User ID: Your Emby user ID
- **Test Connection:** Click to verify settings
- Status indicator shows if connected ✓ or disconnected ✗

**Right Panel - Backend Server + Data Management**
- Backend URL: `http://localhost:5001` (default)
- Server Status: Shows health check result
- **Test Connection:** Verify backend is running
- **Export Data:** Download all rules/schedules as JSON
- **Import Data:** Load previously exported rules/schedules
- **Clear All Data:** Reset all schedules (careful!)

---

## Using the Chronological Playlist Generator

### Overview
The Chronological Playlist Generator creates ordered playlists from external sources (Trakt, MDBlists, file imports) and maintains them in date-added order.

### Tab 1: Dashboard
(Same as Smart Playlist - shows recent activity and upcoming runs)

### Tab 2: Collections

**What are Collections?**
Collections are curated playlists from external sources (Trakt watchlists, MDBlists curated lists, etc.) imported into Emby and kept in chronological order.

**Create a Collection:**

1. **Source Selection**
   - Trakt Watchlist
   - MDBlists List
   - Import from File

2. **If Trakt:**
   - Dropdown shows your watchlists
   - Select desired watchlist
   - Items load in order

3. **If MDBlists:**
   - Enter API key (from Settings)
   - Select from "User Lists" or "Liked Lists"
   - Items load with descriptions

4. **If File Import:**
   - Upload JSON or CSV file
   - Format:
     ```json
     [
       { "title": "Movie Name", "year": 2020 },
       { "title": "Another Movie", "year": 2019 }
     ]
     ```

5. **Playlist Name**
   - Name for the Emby collection
   - Example: "Oscar Winners 2020-2024"

6. **Create Collection**
   - Click "Create"
   - Items are added to Emby in order
   - Collection appears in Emby library

### Tab 3: Scheduled Refreshes

**Auto-Update Collections:**

1. **Select Collection**
   - From dropdown of existing collections

2. **Refresh Frequency**
   - **Daily:** Every day
   - **Weekly:** Every week
   - **Monthly:** Every month

3. **Create Schedule**
   - Collection automatically updates per schedule
   - New items from source are added
   - Maintains chronological order

**Example:**
```
Collection: "Trakt Watchlist"
Refresh: Weekly (every Monday)
→ Every Monday, new items from your Trakt watchlist
  are automatically added to the Emby collection
```

### Tab 4: Trakt Integration

**Setup (already covered in External Services)**

**Using Trakt:**
1. Enter API credentials in Settings
2. Go to Collections tab
3. Select "Trakt Watchlist" as source
4. Pick your watchlist
5. Load and create collection

**Trakt Watchlist Benefits:**
- Automatically synced across devices
- Rate items on Trakt website
- Get recommendations from Trakt
- Share watchlists with friends

### Tab 5: MDBlists Integration

**Setup (already covered in External Services)**

**Using MDBlists:**

1. **Get Your API Key**
   - [https://mdblist.com/preferences/](https://mdblist.com/preferences/)

2. **Load Lists**
   - Go to Collections tab
   - Click "Load User Lists"
   - Paste API key
   - Browse available lists

3. **Popular Lists to Explore**
   - IMDB Top 250
   - Rotten Tomatoes Best
   - Criterion Collection
   - Oscars (by year)
   - Director's filmography

4. **Create Collection**
   - Select list
   - Click "Load Items"
   - Review descriptions
   - Click "Create Collection"

**MDBlists Features:**
- Curated by film experts
- Regular updates
- Detailed descriptions
- Rating aggregates

### Tab 6: Settings

**External Services:**
- Trakt credentials
- MDBlists API key
- Test connections

**Emby Settings:**
- Same as Smart Playlist tab
- Verify connection before using

---

## Advanced Configuration

### Custom Cron Schedules

For advanced users wanting custom timing:

1. Edit the rule directly in browser console
2. Modify `cronExpression` property
3. Examples:
   ```
   "0 0 * * 0"      - Every Sunday at midnight
   "0 9 * * *"      - Every day at 9 AM
   "0 0 1 * *"      - First day of month
   "0 0 * * 1-5"    - Weekdays only
   ```

### Backup and Restore

**Export all data:**
1. Go to Settings tab
2. Click "Export Data"
3. File downloads to your computer

**Restore from backup:**
1. Go to Settings tab
2. Click "Import Data"
3. Select previously exported file
4. All rules and schedules restored

### Running 24/7

To keep the server running even after closing terminal:

```bash
# Using nohup (background process)
cd ~/emby-playlist-manager
nohup node server.js > server.log 2>&1 &

# View logs anytime
tail -f server.log

# Or using screen (session)
screen -S emby-server
node server.js
# Press Ctrl+A then D to detach

# Reattach later
screen -r emby-server
```

### Docker (Advanced)

If you want to containerize the app:

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY . .
RUN npm install
ENV PORT=5001
EXPOSE 5001
CMD ["node", "server.js"]
```

```bash
# Build
docker build -t emby-playlist-manager .

# Run
docker run -p 5001:5001 \
  -e EMBY_URL=http://192.168.1.xxx:8096 \
  -e EMBY_TOKEN=your_token \
  emby-playlist-manager
```

---

## Support & Resources

### Useful Links
- **Emby Documentation:** [emby.media/docs](https://emby.media/docs)
- **Emby API:** [emby.media/community](https://emby.media/community)
- **Trakt API:** [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications)
- **MDBlists:** [mdblist.com](https://mdblist.com)

### Logs Location
- Server logs: Check terminal where `node server.js` runs
- Browser console: Press F12 in browser

### Common Questions

**Q: Can I run multiple schedules at once?**
A: Yes! Schedule as many as you want. They run independently.

**Q: Will playlists update if I add items to Emby?**
A: Smart playlists update based on rules. Chronological update via refresh schedules.

**Q: Can I export playlists to other formats?**
A: Not directly, but you can export all playlist data as JSON via Settings.

**Q: Is this secure?**
A: Runs locally on your network. API tokens stored in `.env` (never commit to git). HTTPS not used (local only recommended).

**Q: Can I run this on a Raspberry Pi?**
A: Yes! Node.js runs on ARM. Just install Node.js and follow same steps.

---

## Version History

**v1.0.0 (June 2026)**
- Initial release
- Smart Playlist Generator with rules engine
- Chronological Playlist Generator with Trakt/MDBlists
- Email notifications
- Web UI with 5+ tabs

---

**Happy playlist creating!** 🎬🎵

For issues or questions, check the troubleshooting section or review logs for error details.
