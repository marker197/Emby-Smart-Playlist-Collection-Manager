# Smart Playlist Generator - Backend Server

Node.js backend server for Smart Playlist Generator & Chronological Playlist apps.

## Quick Start

### Prerequisites
- latest version of Node.js installed
- Emby server running
- Frontend apps running (or accessible)

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Create `.env` file:**
```bash
cp .env.example .env

If using mac.. 
With the file open in TextEdit, click Format in the top menu bar.
Click Make Plain Text (or press Shift + Command + T).Click OK on the warning prompt.Go to File > Save As (hold down the Option key while clicking the File menu to reveal "Save As").Name the file exactly .env and uncheck any box that says "If no extension is provided, use .txt".
```

3. **Edit `.env` with your settings:**
```
EMBY_URL=http://192.168.1.xxx:8096
EMBY_TOKEN=your_api_token
EMBY_USER_ID=your_user_id
```

4. **Start the server:**
```bash
npm start
```

The server will start on `http://localhost:5001`

---

## Development

For development with auto-restart on file changes:

```bash
npm install -g nodemon
npm run dev
```

---

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| EMBY_URL | Your Emby server URL | http://192.168.1.xxx:8096 |
| EMBY_TOKEN | Emby API token | your_token_here |
| EMBY_USER_ID | Your Emby user ID | your_user_id |
| PORT | Server port | 5001 |
| NODE_ENV | Environment | development or production |
| LOG_LEVEL | Logging level | debug, info, warn, error |
| FRONTEND_URL | Frontend URL for CORS | http://localhost:3000 |

### Getting Emby API Token

1. In Emby, go to **Settings → Dashboard → API Keys**
2. Create a new API key
3. Copy the token and add to `.env`



---

## API Endpoints

### Health & Status
```
GET /api/health              # Check server status
GET /api/config              # Get server configuration
```

### Smart Playlist
```
GET  /api/smart/rules                    # List rules
POST /api/smart/schedules                # Create schedule
GET  /api/smart/schedules                # List schedules
GET  /api/smart/schedules/:id            # Get schedule details
PUT  /api/smart/schedules/:id            # Update schedule
DELETE /api/smart/schedules/:id          # Delete schedule
POST /api/smart/schedules/:id/run        # Execute immediately
GET  /api/smart/history                  # Get execution history
POST /api/smart/test-email               # Send test email
```

### Chronological Playlist
```
POST /api/chrono/create                  # Create collection
GET  /api/chrono/collections             # List collections
POST /api/chrono/refresh/:id             # Refresh collection
POST /api/chrono/update-description/:id  # Update description
```

---

## Project Structure

```
backend/
├── server.js                    # Main Express app
├── package.json                 # Dependencies
├── .env.example                 # Environment template
├── services/
│   ├── emby-client.js          # Emby API wrapper
│   ├── rules-engine.js         # Rule evaluation
│   ├── scheduler.js            # Cron job manager
│   ├── email-service.js        # Gmail notifications
│   └── logger.js               # Logging utility
├── data/                        # Persistent data
│   ├── schedules.json          # Stored schedules
│   ├── executions.json         # Execution history
│   └── config.json             # Runtime config
└── logs/                        # Server logs
    └── server-*.log            # Daily log files
```

---

## Services

### EmbyClient
Handles all Emby API communication:
- Fetching library items
- Creating/updating collections
- Managing metadata

### RulesEngine
Evaluates Smart Playlist rules:
- AND/OR logic evaluation
- Condition matching (genre, rating, year, actor, etc.)
- Filtering library items

### Scheduler
Manages automated schedule execution:
- Cron job registration
- Schedule persistence
- Execution history tracking

### EmailService
Sends email notifications via Gmail:
- Playlist creation notifications
- Error alerts
- Test emails

### Logger
Unified logging system:
- Console output
- File-based logging (daily logs)
- Configurable log levels

---

## Troubleshooting

### "Cannot connect to Emby"
- Check `EMBY_URL` and `EMBY_TOKEN` in `.env`
- Verify Emby server is running
- Check network connectivity



### "Schedules not executing"
- Check server logs: `tail -f logs/server-*.log`
- Verify cron expression is valid
- Check schedule is enabled

### "High memory usage"
- Check execution history isn't growing too large
- Restart server to clear in-memory data
- Check for stuck cron jobs

---

## Logs

Server logs are saved in `logs/` directory with daily files:
```
logs/
├── server-2026-06-16.log
├── server-2026-06-17.log
└── ...
```

View recent logs:
```bash
tail -f logs/server-*.log
```

---

## Deployment

### Local Network (Recommended)
Just run `npm start` on your local machine. Ensure:
- Emby server is accessible at the configured URL
- Frontend apps are on same network or can reach backend

### Remote Server
For production deployment:
1. Use a process manager (PM2, systemd, etc.)
2. Use reverse proxy (nginx) for SSL
3. Secure environment variables
4. Set up log rotation
5. Monitor process health

Example with PM2:
```bash
npm install -g pm2
pm2 start server.js --name smart-playlist-backend
pm2 save
pm2 startup
```

---

## Performance Notes

- **Max items per query:** 5000 (configurable)
- **Max execution history:** 1000 per schedule (older deleted)
- **Concurrent schedules:** Limited by system resources
- **Response time:** <500ms for most endpoints

---

## Security

✅ API keys stored in `.env` (never in code)  
✅ CORS configured for frontend only  
✅ Input validation on all endpoints  
✅ Error messages don't expose sensitive data  
✅ Logs don't contain tokens/passwords  

---

## Support

For issues or questions:
1. Check logs: `tail -f logs/server-*.log`
2. Verify `.env` configuration
3. Test Emby connection: `curl http://your-emby-url/System/Info`
4. Test email: `POST /api/smart/test-email`

---

## Version History

- **v2.0.0** (2026-06-16) - Initial release
  - Smart Playlist scheduling
  - Chronological Playlist integration
  - Email notifications
  - Execution history

---

## License

MIT

---

**Last Updated:** 2026-06-16
