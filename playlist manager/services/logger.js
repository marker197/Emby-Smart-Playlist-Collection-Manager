// ═════════════════════════════════════════════
// Logger Service
// ═════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.logDir = path.join(__dirname, '..', 'logs');
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getTimestamp() {
    return new Date().toISOString();
  }

  formatMessage(level, message, data) {
    const timestamp = this.getTimestamp();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const msg = data ? `${message} ${JSON.stringify(data)}` : message;
    return `${prefix} ${msg}`;
  }

  writeLog(level, message, data) {
    const formatted = this.formatMessage(level, message, data);
    
    // Console output
    console.log(formatted);

    // File output (optional)
    try {
      const logFile = path.join(this.logDir, `server-${new Date().toISOString().split('T')[0]}.log`);
      fs.appendFileSync(logFile, formatted + '\n');
    } catch (e) {
      // Silently fail if can't write to file
    }
  }

  debug(message, data) {
    if (['debug'].includes(this.logLevel)) {
      this.writeLog('debug', message, data);
    }
  }

  info(message, data) {
    if (['debug', 'info'].includes(this.logLevel)) {
      this.writeLog('info', message, data);
    }
  }

  warn(message, data) {
    if (['debug', 'info', 'warn'].includes(this.logLevel)) {
      this.writeLog('warn', message, data);
    }
  }

  error(message, error) {
    const data = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack.split('\n').slice(0, 3).join(' | ')
    } : error;
    this.writeLog('error', message, data);
  }
}

module.exports = Logger;
