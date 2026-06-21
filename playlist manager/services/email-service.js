// ═════════════════════════════════════════════
// Email Service
// ═════════════════════════════════════════════

const nodemailer = require('nodemailer');

class EmailService {
  constructor(gmailAddress, appPassword, logger) {
    this.gmailAddress = gmailAddress || '';
    this.appPassword = appPassword || '';
    this.logger = logger;
    this.transporter = null;
    
    if (this.gmailAddress && this.appPassword) {
      this.initializeTransporter();
    }
  }

  initializeTransporter() {
    try {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: this.gmailAddress,
          pass: this.appPassword
        }
      });

      this.logger.info('Email service initialized');
    } catch (error) {
      this.logger.error('Email service initialization failed', error);
    }
  }

  async sendPlaylistCreated(to, playlistName, itemCount) {
    if (!this.transporter || !to) {
      this.logger.warn('Email service not configured or no recipient');
      return false;
    }

    try {
      const htmlContent = `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <h2 style="color: #3498db;">✓ Playlist Created</h2>
            <p>Your smart playlist has been successfully created!</p>
            <div style="background: #f0f0f0; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p><strong>Playlist:</strong> ${playlistName}</p>
              <p><strong>Items:</strong> ${itemCount} movies added</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            </div>
            <p>Check your Emby library to see the new playlist!</p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="font-size: 12px; color: #666;">
              This is an automated notification from Smart Playlist Generator
            </p>
          </body>
        </html>
      `;

      await this.transporter.sendMail({
        from: this.gmailAddress,
        to: to,
        subject: `Playlist Created: ${playlistName}`,
        html: htmlContent
      });

      this.logger.info(`Email sent: ${playlistName} → ${to}`);
      return true;
    } catch (error) {
      this.logger.error('Send playlist notification failed', error);
      return false;
    }
  }

  async sendPlaylistError(to, playlistName, error) {
    if (!this.transporter || !to) {
      this.logger.warn('Email service not configured or no recipient');
      return false;
    }

    try {
      const htmlContent = `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <h2 style="color: #e74c3c;">✗ Playlist Creation Failed</h2>
            <p>There was an error creating your smart playlist.</p>
            <div style="background: #fff0f0; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #e74c3c;">
              <p><strong>Playlist:</strong> ${playlistName}</p>
              <p><strong>Error:</strong> ${error}</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            </div>
            <p>Please check your server logs or try again later.</p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="font-size: 12px; color: #666;">
              This is an automated notification from Smart Playlist Generator
            </p>
          </body>
        </html>
      `;

      await this.transporter.sendMail({
        from: this.gmailAddress,
        to: to,
        subject: `Playlist Error: ${playlistName}`,
        html: htmlContent
      });

      this.logger.info(`Error notification sent: ${playlistName} → ${to}`);
      return true;
    } catch (error) {
      this.logger.error('Send error notification failed', error);
      return false;
    }
  }

  async sendTestEmail(to) {
    if (!this.transporter) {
      this.logger.warn('Email service not configured - transporter missing');
      throw new Error('Email service not configured');
    }
    
    if (!to) {
      this.logger.warn('Email test called without recipient');
      throw new Error('No recipient email provided');
    }

    try {
      this.logger.info(`Attempting to send test email to: ${to}`);
      
      const htmlContent = `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <h2 style="color: #2ecc71;">✓ Test Email Successful</h2>
            <p>Your email notification service is working correctly!</p>
            <div style="background: #f0fff0; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #2ecc71;">
              <p><strong>Service:</strong> Smart Playlist Generator</p>
              <p><strong>Status:</strong> Connected</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            </div>
            <p>You will receive notifications when playlists are created or if errors occur.</p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="font-size: 12px; color: #666;">
              This is an automated notification from Smart Playlist Generator
            </p>
          </body>
        </html>
      `;

      const result = await this.transporter.sendMail({
        from: this.gmailAddress,
        to: to,
        subject: 'Smart Playlist Generator - Test Email',
        html: htmlContent
      });

      this.logger.info(`✓ Test email sent successfully to: ${to}. Response: ${result.messageId}`);
      return true;
    } catch (error) {
      this.logger.error(`✗ Test email FAILED to: ${to}`, error);
      throw error;
    }
  }

  async verify() {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      this.logger.info('Email service verified');
      return true;
    } catch (error) {
      this.logger.error('Email service verification failed', error);
      return false;
    }
  }
}

module.exports = EmailService;
