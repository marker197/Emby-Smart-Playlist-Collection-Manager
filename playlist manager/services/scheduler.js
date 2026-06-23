// ═════════════════════════════════════════════
// Scheduler Service
// ═════════════════════════════════════════════

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class Scheduler {
  constructor(embyClient, rulesEngine, logger, listSyncService) {
    this.embyClient = embyClient;
    this.rulesEngine = rulesEngine;
    this.logger = logger;
    this.listSyncService = listSyncService;
    this.schedules = new Map();
    this.executions = [];
    this.dataDir = path.join(__dirname, '..', 'data');
    this.schedulesFile = path.join(this.dataDir, 'schedules.json');
    this.executionsFile = path.join(this.dataDir, 'executions.json');
    
    this.initializeDataDirectory();
    this.loadSchedules();
  }

  // ═════════════════════════════════════════════
  // INITIALIZATION
  // ═════════════════════════════════════════════

  initializeDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  loadSchedules() {
    try {
      if (fs.existsSync(this.schedulesFile)) {
        const data = fs.readFileSync(this.schedulesFile, 'utf8');
        const schedules = JSON.parse(data);

        schedules.forEach(schedule => {
          this.schedules.set(schedule.id, schedule);
          
          // Re-register enabled schedules
          if (schedule.enabled) {
            this.registerCronJob(schedule);
          }
        });

        this.logger.info(`Loaded ${schedules.length} schedules`);
      }

      if (fs.existsSync(this.executionsFile)) {
        const data = fs.readFileSync(this.executionsFile, 'utf8');
        this.executions = JSON.parse(data);
        this.logger.info(`Loaded ${this.executions.length} executions`);
      }
    } catch (error) {
      this.logger.error('Load schedules failed', error);
    }
  }

  // ═════════════════════════════════════════════
  // SCHEDULE MANAGEMENT
  // ═════════════════════════════════════════════

  addSchedule(scheduleConfig) {
    try {
      const schedule = {
        ...scheduleConfig,
        nextRun: this.calculateNextRun(scheduleConfig.cronExpression),
        lastRun: null
      };

      this.schedules.set(schedule.id, schedule);
      this.saveSchedules();

      if (schedule.enabled) {
        this.registerCronJob(schedule);
        this.logger.info(`Cron job registered: ${schedule.id}`);
      }

      return schedule;
    } catch (error) {
      this.logger.error('Add schedule failed', error);
      throw error;
    }
  }

  getSchedules() {
    return Array.from(this.schedules.values());
  }

  getSchedule(scheduleId) {
    return this.schedules.get(scheduleId);
  }

  updateSchedule(scheduleId, updates) {
    try {
      const schedule = this.schedules.get(scheduleId);
      if (!schedule) return null;

      // Remove old cron job if changing expression
      if (updates.cronExpression && updates.cronExpression !== schedule.cronExpression) {
        this.unregisterCronJob(schedule.id);
      }

      // Update schedule
      Object.assign(schedule, updates);
      schedule.nextRun = this.calculateNextRun(schedule.cronExpression);

      this.schedules.set(scheduleId, schedule);
      this.saveSchedules();

      // Register new cron job if enabled
      if (schedule.enabled) {
        this.registerCronJob(schedule);
      }

      return schedule;
    } catch (error) {
      this.logger.error('Update schedule failed', error);
      throw error;
    }
  }

  removeSchedule(scheduleId) {
    try {
      const schedule = this.schedules.get(scheduleId);
      if (!schedule) return false;

      // Stop the cron job
      this.unregisterCronJob(scheduleId);
      
      // Remove from memory
      this.schedules.delete(scheduleId);
      
      // Persist deletion to file immediately
      this.saveSchedules();

      console.log(`[Scheduler] ✓ Schedule deleted: ${scheduleId} (removed from memory and file)`);
      this.logger.info(`Schedule removed: ${scheduleId}`);
      return true;
    } catch (error) {
      console.error(`[Scheduler] ✗ Remove schedule failed:`, error);
      this.logger.error('Remove schedule failed', error);
      throw error;
    }
  }

  // ═════════════════════════════════════════════
  // CRON JOB MANAGEMENT
  // ═════════════════════════════════════════════

  registerCronJob(schedule) {
    try {
      // Validate cron expression
      if (!cron.validate(schedule.cronExpression)) {
        this.logger.warn(`Invalid cron expression: ${schedule.cronExpression}`);
        return;
      }

      // Create cron task
      const task = cron.schedule(schedule.cronExpression, async () => {
        await this.executeSchedule(schedule.id);
      });

      // Store task for later cleanup
      schedule.cronJob = task;

      this.logger.info(`Cron job registered: ${schedule.playlistName} (${schedule.cronExpression})`);
    } catch (error) {
      this.logger.error('Register cron job failed', error);
    }
  }

  unregisterCronJob(scheduleId) {
    try {
      const schedule = this.schedules.get(scheduleId);
      if (schedule && schedule.cronJob) {
        schedule.cronJob.stop();
        delete schedule.cronJob;
        this.logger.info(`Cron job unregistered: ${scheduleId}`);
      }
    } catch (error) {
      this.logger.error('Unregister cron job failed', error);
    }
  }

  // ═════════════════════════════════════════════
  // EXECUTION
  // ═════════════════════════════════════════════

  async executeSchedule(scheduleId) {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      this.logger.warn(`Schedule not found: ${scheduleId}`);
      return;
    }

    const execution = {
      id: 'exec_' + uuidv4(),
      scheduleId,
      status: 'running',
      startedAt: new Date().toISOString(),
      itemsMatched: 0,
      playlistName: schedule.playlistName,
      error: null
    };

    try {
      this.logger.info(`Executing schedule: ${schedule.playlistName}`);

      // Get library items
      const items = await this.embyClient.getLibraryItems();
      this.logger.info(`Total library items: ${items.length}`);

      // DEBUG: Log first item structure to see genre format
      if (items.length > 0) {
        this.logger.info(`First item structure:`);
        this.logger.info(`  Name: ${items[0].Name}`);
        this.logger.info(`  GenreItems:`, JSON.stringify(items[0].GenreItems));
        this.logger.info(`  Genres:`, JSON.stringify(items[0].Genres));
        this.logger.info(`  All keys:`, Object.keys(items[0]));
      }

      // Evaluate rule if provided
      let matchedItems = items;
      if (schedule.rule) {
        this.logger.info(`Evaluating rule for schedule: ${schedule.ruleId}`);
        matchedItems = this.rulesEngine.evaluateRule(schedule.rule, items);
        this.logger.info(`Rule matched ${matchedItems.length} items`);
      } else {
        this.logger.warn(`No rule attached to schedule ${schedule.id}, using all items`);
      }

      // Take first 50 matched items
      const finalItems = matchedItems.slice(0, Math.min(100, matchedItems.length));
      this.logger.info(`Creating collection with ${finalItems.length} items (max 100)`);

      // Create collection in Emby (or update existing one with the same name)
      const collection = await this.embyClient.createOrUpdateCollectionByName(
        schedule.playlistName,
        finalItems.map(i => i.Id),
        schedule.description || ''
      );

      // Description is set inside createOrUpdateCollectionByName — no second call needed.

      execution.status = 'success';
      execution.itemsMatched = finalItems.length;
      execution.playlistId = collection.id;

      // Publish to Trakt/MDBlists if this schedule has it enabled — runs on every
      // execution (manual or cron), so the external list stays in step automatically
      if ((schedule.publishToTrakt || schedule.publishToMDBlists) && this.listSyncService) {
        try {
          const publishItems = finalItems.map(i => ({
            name: i.Name,
            imdb: i.ProviderIds && (i.ProviderIds.Imdb || i.ProviderIds.IMDB) || null,
            tmdb: i.ProviderIds && (i.ProviderIds.Tmdb || i.ProviderIds.TMDB) || null
          })).filter(i => i.imdb || i.tmdb);

          const publishResult = await this.listSyncService.publishSmartList(schedule, publishItems);

          // Persist any newly-created (or recreated, if deleted externally) list
          // ids/URLs back onto the schedule, so a self-healed URL sticks too
          let scheduleChanged = false;
          if (publishResult.traktListId && publishResult.traktListId !== schedule.traktListId) {
            schedule.traktListId = publishResult.traktListId;
            scheduleChanged = true;
          }
          if (publishResult.mdblistListId && publishResult.mdblistListId !== schedule.mdblistListId) {
            schedule.mdblistListId = publishResult.mdblistListId;
            scheduleChanged = true;
          }
          if (publishResult.traktListUrl && publishResult.traktListUrl !== schedule.traktListUrl) {
            schedule.traktListUrl = publishResult.traktListUrl;
            scheduleChanged = true;
          }
          if (publishResult.mdblistListUrl && publishResult.mdblistListUrl !== schedule.mdblistListUrl) {
            schedule.mdblistListUrl = publishResult.mdblistListUrl;
            scheduleChanged = true;
          }
          if (scheduleChanged) this.saveSchedules();

          execution.publishResult = {
            traktAdded: publishResult.traktAdded,
            traktRemoved: publishResult.traktRemoved,
            traktListUrl: publishResult.traktListUrl || schedule.traktListUrl || null,
            mdblistAdded: publishResult.mdblistAdded,
            mdblistRemoved: publishResult.mdblistRemoved,
            mdblistListUrl: publishResult.mdblistListUrl || schedule.mdblistListUrl || null
          };

          this.logger.info(`   ✓ Published "${schedule.playlistName}": Trakt +${publishResult.traktAdded}/-${publishResult.traktRemoved}, MDBlists +${publishResult.mdblistAdded}/-${publishResult.mdblistRemoved}`);
        } catch (e) {
          this.logger.warn(`   Smart list publish failed for "${schedule.playlistName}": ${e.message}`);
        }
      }

      // Update schedule
      schedule.lastRun = new Date().toISOString();
      schedule.nextRun = this.calculateNextRun(schedule.cronExpression);
      this.saveSchedules();

      this.logger.info(`Schedule execution completed: ${schedule.playlistName} (${matchedItems.length} items)`);
    } catch (error) {
      execution.status = 'failed';
      execution.error = error.message;
      this.logger.error(`Schedule execution failed: ${schedule.playlistName}`, error);
    } finally {
      execution.completedAt = new Date().toISOString();
      execution.duration = new Date(execution.completedAt) - new Date(execution.startedAt);
      
      this.executions.push(execution);
      this.saveExecutions();
    }

    return execution;
  }

  async executeScheduleNow(scheduleId) {
    try {
      const execution = await this.executeSchedule(scheduleId);
      return {
        success: true,
        execution: {
          id: execution.id,
          status: execution.status,
          itemsMatched: execution.itemsMatched,
          error: execution.error,
          completedAt: execution.completedAt,
          publishResult: execution.publishResult || null
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ═════════════════════════════════════════════
  // HISTORY & TRACKING
  // ═════════════════════════════════════════════

  getExecutionHistory(scheduleId, limit = 50) {
    return this.executions
      .filter(e => e.scheduleId === scheduleId)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, limit);
  }

  // ═════════════════════════════════════════════
  // UTILITIES
  // ═════════════════════════════════════════════

  calculateNextRun(cronExpression) {
    try {
      // Parse cron and calculate next run
      const cronValues = cronExpression.split(' ');
      
      // Simple approximation - in production, use a proper cron parser
      const now = new Date();
      
      // This is a placeholder - a real implementation would use cron-parser
      // For now, just return approximate next run
      const daysToAdd = 7; // Default to 1 week
      const nextRun = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      
      return nextRun.toISOString();
    } catch (error) {
      return new Date().toISOString();
    }
  }

  getActiveScheduleCount() {
    return Array.from(this.schedules.values()).filter(s => s.enabled).length;
  }

  // ═════════════════════════════════════════════
  // PERSISTENCE
  // ═════════════════════════════════════════════

  saveSchedules() {
    try {
      // Don't persist cron job objects
      const schedules = Array.from(this.schedules.values()).map(s => ({
        ...s,
        cronJob: undefined
      }));

      fs.writeFileSync(this.schedulesFile, JSON.stringify(schedules, null, 2));
      console.log(`[Scheduler] Schedules saved to ${this.schedulesFile} (${schedules.length} schedules)`);
    } catch (error) {
      console.error(`[Scheduler] ✗ Save schedules failed:`, error);
      this.logger.error('Save schedules failed', error);
    }
  }

  saveExecutions() {
    try {
      // Keep last 1000 executions
      const recent = this.executions.slice(-1000);
      fs.writeFileSync(this.executionsFile, JSON.stringify(recent, null, 2));
    } catch (error) {
      this.logger.error('Save executions failed', error);
    }
  }
}

module.exports = Scheduler;
