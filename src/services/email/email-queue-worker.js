const nodemailer = require("nodemailer");
const db = require("../../database/database.js");
const timezoneScheduler = require("./timezone-scheduler");

/**
 * Validate and reschedule an email if its scheduled time is outside business hours
 * Returns true if the email should be sent, false if it was rescheduled
 */
function validateScheduledTime(email) {
  const countryCode = email.country_code || email.site_country || 'in';
  const scheduledAt = email.scheduled_at ? new Date(email.scheduled_at) : null;

  if (!scheduledAt) {
    // No scheduled time - this is legacy data, check current time
    const now = new Date();
    if (!timezoneScheduler.isBusinessHour(now, countryCode)) {
      // Reschedule to next business hour
      const nextValidTime = timezoneScheduler.calculateFirstSendTime(countryCode);
      db.run(
        "UPDATE email_queue SET scheduled_at = ? WHERE id = ?",
        [nextValidTime.toISOString(), email.id]
      );
      return false;
    }
    return true;
  }

  // Check if the scheduled time is actually within business hours
  if (!timezoneScheduler.isBusinessHour(scheduledAt, countryCode)) {
    // Reschedule to next valid business hour
    const nextValidTime = timezoneScheduler.adjustToBusinessHours(scheduledAt, countryCode);
    db.run(
      "UPDATE email_queue SET scheduled_at = ? WHERE id = ?",
      [nextValidTime.toISOString(), email.id]
    );
    return false;
  }

  return true;
}

/**
 * Calculate and set scheduled_at for an email that doesn't have one yet
 * This handles:
 * - Sequence emails (uses previous email's time + gap)
 * - Regular emails (next business time)
 * Returns true if the email should be sent now, false if scheduled for later
 */
function scheduleEmail(email) {
  const countryCode = email.country_code || email.site_country || 'in';
  const now = new Date();

  // For sequence emails, we need to calculate based on previous email in the sequence
  if (email.tag && email.sequence_position > 1) {
    // This is a follow-up email - find the previous email in the sequence
    const previousEmail = db.get(`
      SELECT sent_at, scheduled_at
      FROM email_queue
      WHERE contact_id = ?
        AND campaign_id = ?
        AND sequence_position = ?
        AND status = 'sent'
      ORDER BY sent_at DESC
      LIMIT 1
    `, [email.contact_id, email.campaign_id, email.sequence_position - 1]);

    if (!previousEmail) {
      return false; // Don't schedule follow-ups if previous step wasn't sent
    }

    // Only use the previous email's sent_at as base (must be actually sent)
    const baseTime = new Date(previousEmail.sent_at);

    // Get the gap from email_settings for this sequence position
    const gapSetting = db.get(
      `SELECT value FROM email_settings WHERE key = ?`,
      [`followup_gap_${email.sequence_position - 1}`]
    );
    const gapDays = gapSetting ? parseInt(gapSetting.value) : (email.sequence_position === 2 ? 2 : 5);

    // Calculate follow-up date
    const scheduledAt = timezoneScheduler.calculateFollowUpDate(baseTime, gapDays, countryCode);

    db.run(
      "UPDATE email_queue SET scheduled_at = ? WHERE id = ?",
      [scheduledAt.toISOString(), email.id]
    );

    // Check if scheduled time has arrived
    return scheduledAt <= now;
  }

  // For regular emails or if sequence logic failed, schedule for next business time
  const firstSendTime = timezoneScheduler.calculateFirstSendTime(countryCode);

  db.run(
    "UPDATE email_queue SET scheduled_at = ? WHERE id = ?",
    [firstSendTime.toISOString(), email.id]
  );

  // Check if scheduled time has arrived
  return firstSendTime <= now;
}

/**
 * Email Queue Worker (Enhanced)
 * Processes emails from the queue using:
 * - Timezone-aware prioritization (countries in business hours first)
 * - Parallel sending per sender
 * - Round-robin distribution
 */

class EmailQueueWorker {
  constructor() {
    this.isProcessing = false;
    this.currentSenderIndex = 0;
    this.emailsSentInBatch = 0;
    this.batchSize = 5;
    this.checkInterval = null;
    this.isPaused = false;
    // Enhanced: Track active sends per sender for parallel processing
    this.activeSendsPerSender = new Map(); // senderId -> count
    this.maxParallelPerSender = 2; // Max 2 concurrent sends per sender
    // Enable parallel mode (can be toggled via settings)
    this.parallelMode = true;
  }

  /**
   * Start the queue worker
   */
  start() {
    if (this.isProcessing && this.checkInterval) {
      return; // Silent return
    }

    this.isProcessing = true;
    // Silent start - no console spam

    // Create worker_errors table if not exists
    this.createErrorTable();

    // Process immediately
    this.processQueue();

    // Check every 30 seconds for new emails
    this.checkInterval = setInterval(() => {
      // Always try to process, even if isProcessing is false (recovery mechanism)
      if (!this.isProcessing && !this.isPaused) {
        this.isProcessing = true;
        this.processQueue();
      }
      // Silent health check
    }, 30000);
  }

  /**
   * Stop the queue worker
   */
  stop() {
    this.isProcessing = false;
    this.isPaused = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    // Silent stop
  }

  /**
   * Pause processing (keeps worker alive but stops picking new items)
   */
  pause() {
    this.isPaused = true;
    this.isProcessing = false;
    console.log("  Queue processing paused");
  }

  /**
   * Resume processing after pause
   */
  resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.isProcessing = true;
      this.processQueue();
      console.log("▶️  Queue processing resumed");
    }
  }

  /**
   * Trigger immediate queue processing (called from API when user clicks Start Queue)
   */
  triggerNow() {
    if (this.isPaused) {
      this.isPaused = false;
    }
    this.isProcessing = true;

    // Clear any existing check interval and restart it
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.checkInterval = setInterval(() => {
      if (!this.isProcessing && !this.isPaused) {
        this.isProcessing = true;
        this.processQueue();
      }
    }, 30000);

    // Process immediately
    this.processQueue();
    console.log(" Queue processing triggered immediately!");
    return { success: true, message: "Queue processing started immediately" };
  }

  /**
   * Get active sender accounts
   */
  getActiveSenders() {
    const senders = db.all(`
      SELECT * FROM email_senders
      WHERE is_active = 1
      ORDER BY created_at ASC
    `);
    return senders;
  }

  /**
   * Get countries currently in business hours
   */
  getCountriesInBusiness() {
    try {
      return timezoneScheduler.getCountriesInBusiness().map(c => c.country);
    } catch (error) {
      console.warn("Could not get countries in business:", error.message);
      return [];
    }
  }

  /**
   * Get next email with timezone-aware prioritization
   * Prioritizes emails for countries currently in business hours
   */
  getNextEmail() {
    const countriesInBusiness = this.getCountriesInBusiness();
    const now = new Date().toISOString();

    // First, try to get emails for countries in business hours
    if (countriesInBusiness.length > 0) {
      const placeholders = countriesInBusiness.map(() => '?').join(',');
      const businessHoursEmail = db.get(
        `
        SELECT eq.*,
               s.country as site_country,
               s.url as site_url
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE eq.status = 'queued'
          AND (eq.scheduled_at IS NULL OR eq.scheduled_at <= ?)
          AND s.country IN (${placeholders})
        ORDER BY eq.created_at ASC
        LIMIT 1
        `,
        [now, ...countriesInBusiness.map(c => c.toUpperCase())],
      );

      if (businessHoursEmail) {
        console.log(`🌍 Priority: Sending to ${businessHoursEmail.site_country || 'unknown'} (currently in business hours)`);
        return businessHoursEmail;
      }
    }

    // Fallback: get any queued email that's due (already has scheduled_at)
    let email = db.get(
      `
      SELECT eq.*,
             s.country as site_country,
             s.url as site_url
      FROM email_queue eq
      LEFT JOIN sites s ON eq.contact_id = (
        SELECT site_id FROM contacts WHERE id = eq.contact_id LIMIT 1
      )
      WHERE eq.status = 'queued'
        AND eq.scheduled_at IS NOT NULL
        AND eq.scheduled_at <= ?
      ORDER BY eq.created_at ASC
      LIMIT 1
      `,
      [now],
    );

    // If no scheduled emails are due, check for unscheduled emails and schedule them
    if (!email) {
      email = db.get(
        `
        SELECT eq.*,
               s.country as site_country,
               s.url as site_url
        FROM email_queue eq
        LEFT JOIN sites s ON eq.contact_id = (
          SELECT site_id FROM contacts WHERE id = eq.contact_id LIMIT 1
        )
        WHERE eq.status = 'queued'
          AND eq.scheduled_at IS NULL
        ORDER BY eq.created_at ASC
        LIMIT 1
        `,
        [],
      );

      if (email) {
        // This email has no scheduled_at yet - schedule it now
        const shouldSendNow = scheduleEmail(email);

        // If it's scheduled for later, don't return it (not ready to send)
        if (!shouldSendNow) {
          console.log(`  Email ${email.recipient_email} scheduled for later - not ready to send yet`);
          return null;
        }
      }
    }

    return email;
  }

  /**
   * Get next batch of emails for parallel processing
   * Returns up to N emails that can be sent concurrently to different senders
   */
  getNextEmailBatch(maxBatchSize = 3) {
    const countriesInBusiness = this.getCountriesInBusiness();
    const now = new Date().toISOString();
    const senders = this.getActiveSenders();

    if (senders.length === 0) return [];

    // Build batch with available senders
    const batch = [];
    const usedSenders = new Set();

    // First, prioritize business hours emails
    for (const sender of senders) {
      if (batch.length >= maxBatchSize) break;
      if (usedSenders.has(sender.id)) continue;
      if (sender.sent_today >= sender.daily_limit) continue;

      const activeCount = this.activeSendsPerSender.get(sender.id) || 0;
      if (activeCount >= this.maxParallelPerSender) continue;

      let email;
      if (countriesInBusiness.length > 0) {
        // Try business hours first
        const placeholders = countriesInBusiness.map(() => '?').join(',');
        email = db.get(
          `
          SELECT eq.*,
                 s.country as site_country
          FROM email_queue eq
          LEFT JOIN sites s ON eq.contact_id = (
            SELECT site_id FROM contacts WHERE id = eq.contact_id LIMIT 1
          )
          WHERE eq.status = 'queued'
            AND eq.scheduled_at IS NOT NULL
            AND eq.scheduled_at <= ?
            AND s.country IN (${placeholders})
          ORDER BY eq.created_at ASC
          LIMIT 1
          `,
          [now, ...countriesInBusiness.map(c => c.toUpperCase())],
        );
      }

      // If no business hours email available, try any scheduled email that's due
      if (!email) {
        email = db.get(
          `
          SELECT eq.*,
                 s.country as site_country
          FROM email_queue eq
          LEFT JOIN sites s ON eq.contact_id = (
            SELECT site_id FROM contacts WHERE id = eq.contact_id LIMIT 1
          )
          WHERE eq.status = 'queued'
            AND eq.scheduled_at IS NOT NULL
            AND eq.scheduled_at <= ?
          ORDER BY eq.created_at ASC
          LIMIT 1
          `,
          [now],
        );
      }

      // If still no email, try to schedule an unscheduled one
      if (!email) {
        email = db.get(
          `
          SELECT eq.*,
                 s.country as site_country
          FROM email_queue eq
          LEFT JOIN sites s ON eq.contact_id = (
            SELECT site_id FROM contacts WHERE id = eq.contact_id LIMIT 1
          )
          WHERE eq.status = 'queued'
            AND eq.scheduled_at IS NULL
          ORDER BY eq.created_at ASC
          LIMIT 1
          `,
          [],
        );

        if (email) {
          // Schedule the email and check if it should be sent now
          const shouldSendNow = scheduleEmail(email);
          if (!shouldSendNow) {
            // Email is scheduled for later, skip it
            continue;
          }
        }
      }

      if (email) {
        batch.push({ email, sender });
        usedSenders.add(sender.id);
        // Mark as sending to prevent duplicates in same batch
        db.run("UPDATE email_queue SET status = 'sending' WHERE id = ?", [email.id]);
      }
    }

    return batch;
  }

  /**
   * Reset daily counters if needed
   */
  checkDailyReset() {
    const today = new Date().toDateString();

    db.all("SELECT * FROM email_senders").forEach((sender) => {
      if (sender.last_reset_date !== today) {
        db.run(
          `
          UPDATE email_senders
          SET sent_today = 0,
              last_reset_date = ?
          WHERE id = ?
        `,
          [today, sender.id],
        );
        console.log(` Reset daily counter for: ${sender.name}`);
      }
    });
  }

  /**
   * Get next sender in round-robin
   */
  getNextSender() {
    const senders = this.getActiveSenders();

    if (senders.length === 0) {
      console.error(" No active email senders found!");
      return null;
    }

    // Find next available sender (under daily limit)
    let attempts = 0;
    const maxAttempts = senders.length;

    while (attempts < maxAttempts) {
      const sender = senders[this.currentSenderIndex];

      if (sender.sent_today < sender.daily_limit) {
        this.currentSenderIndex =
          (this.currentSenderIndex + 1) % senders.length;
        return sender;
      }

      console.log(
        `⚠️  ${sender.name} has reached daily limit (${sender.sent_today}/${sender.daily_limit})`,
      );
      this.currentSenderIndex = (this.currentSenderIndex + 1) % senders.length;
      attempts++;
    }

    console.warn("⚠️  All senders have reached daily limit!");
    return null;
  }

  /**
   * Send email
   */
  async sendEmail(sender, emailData) {
    let transporter;

    try {
      // Create transporter
      if (sender.service === "custom") {
        transporter = nodemailer.createTransport({
          host: sender.smtp_host,
          port: sender.smtp_port,
          secure: sender.smtp_port === 465,
          auth: {
            user: sender.smtp_user || sender.email, // Use smtp_user if provided, otherwise email
            pass: sender.password,
          },
        });
      } else {
        transporter = nodemailer.createTransport({
          service: sender.service,
          auth: {
            user: sender.smtp_user || sender.email, // Use smtp_user if provided, otherwise email
            pass: sender.password,
          },
        });
      }

      // Final variable replacement for sender-specific variables
      let subject = emailData.subject;
      let html = emailData.html_content;
      let text = emailData.text_content || "";

      const senderName = sender.name || "";
      [subject, html, text] = [subject, html, text].map((content) => {
        if (!content) return content;
        return content
          .split("{{sender_name}}")
          .join(senderName)
          .split("{{receiver_name}}")
          .join(senderName); // Alias as requested by user
      });

      // Send email
      const mailOptions = {
        from: sender.email,
        to: emailData.recipient_email,
        subject: subject,
        html: html,
        text: text,
      };

      const info = await transporter.sendMail(mailOptions);

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process a single email send with error handling
   */
  async processSingleEmail(email, sender) {
    // Validate scheduled time is within business hours
    if (!validateScheduledTime(email)) {
      return { success: false, rescheduled: true };
    }

    const result = await this.sendEmail(sender, email);

    if (result.success) {
      // Update queue item
      db.run(
        `
        UPDATE email_queue
        SET status = 'sent',
            sender_id = ?,
            sent_at = CURRENT_TIMESTAMP,
            attempts = attempts + 1
        WHERE id = ?
      `,
        [sender.id, email.id],
      );

      // Update contact send log history
      if (email.contact_id && email.campaign_id) {
        try {
          // Convert sequence_position (1, 2, 3...) to send_type (main, followup_1, followup_2...)
          const sequencePos = email.sequence_position || 1;
          const sendType =
            sequencePos === 1 ? "main" : `followup_${sequencePos - 1}`;

          db.run(
            `
                  UPDATE email_send_log
                  SET status = 'sent', sent_at = CURRENT_TIMESTAMP
                  WHERE contact_id = ? AND campaign_id = ? AND send_type = ?
              `,
            [email.contact_id, email.campaign_id, sendType],
          );
        } catch (logError) {
          console.warn(
            "⚠️  Could not update email_send_log history:",
            logError.message,
          );
        }
      }

      // Update sender counter
      db.run(
        `
        UPDATE email_senders
        SET sent_today = sent_today + 1
        WHERE id = ?
      `,
        [sender.id],
      );

      // Update campaign counter
      if (email.campaign_id) {
        db.run(
          `
          UPDATE email_campaigns
          SET sent_count = sent_count + 1
          WHERE id = ?
        `,
          [email.campaign_id],
        );
      }

      console.log(` Email sent successfully to ${email.recipient_email}`);
      this.emailsSentInBatch++;
      return { success: true };
    } else {
      // Update queue item with error
      const newAttempts = (email.attempts || 0) + 1;

      if (newAttempts >= 3) {
        db.run(
          `
          UPDATE email_queue
          SET status = 'failed',
              error_message = ?,
              attempts = ?
          WHERE id = ?
        `,
          [result.error, newAttempts, email.id],
        );

        // Update campaign counter
        if (email.campaign_id) {
          db.run(
            `
            UPDATE email_campaigns
            SET failed_count = failed_count + 1
            WHERE id = ?
          `,
            [email.campaign_id],
          );
        }

        console.error(`💀 Email failed after 3 attempts: ${result.error}`);
      } else {
        const rescheduleTime = new Date();
        rescheduleTime.setMinutes(rescheduleTime.getMinutes() + 15);
        db.run(
          `
          UPDATE email_queue
          SET status = 'queued',
              attempts = ?,
              error_message = ?,
              scheduled_at = ?
          WHERE id = ?
        `,
          [newAttempts, result.error, rescheduleTime.toISOString(), email.id],
        );

        console.error(
          ` Email failed (attempt ${newAttempts}/3). Rescheduling +15 mins: ${result.error}`,
        );
      }
      return { success: false, error: result.error };
    }
  }

  /**
   * Process the email queue (with global error handling)
   * Enhanced with parallel processing support
   */
  async processQueue() {
    if (!this.isProcessing) return;

    try {
      // Check daily reset
      this.checkDailyReset();

      // Try parallel batch processing first
      if (this.parallelMode) {
        const batch = this.getNextEmailBatch(3);

        if (batch.length > 0) {
          console.log(`\n📧 Processing batch of ${batch.length} emails in parallel...`);

          // Track active sends
          batch.forEach(({ sender }) => {
            this.activeSendsPerSender.set(
              sender.id,
              (this.activeSendsPerSender.get(sender.id) || 0) + 1
            );
          });

          // Process all emails in parallel
          const promises = batch.map(({ email, sender }) => {
            console.log(`   To: ${email.recipient_email} (${email.site_country || 'unknown'}) via ${sender.name}`);
            return this.processSingleEmail(email, sender);
          });

          const results = await Promise.all(promises);

          // Handle rescheduled emails - don't count them as failures
          const rescheduledCount = results.filter(r => r && r.rescheduled).length;
          if (rescheduledCount > 0) {
            console.log(`   ${rescheduledCount} email(s) rescheduled to business hours`);
          }

          // Clear active sends tracking
          batch.forEach(({ sender }) => {
            const count = (this.activeSendsPerSender.get(sender.id) || 1) - 1;
            if (count <= 0) {
              this.activeSendsPerSender.delete(sender.id);
            } else {
              this.activeSendsPerSender.set(sender.id, count);
            }
          });

          // Wait before next batch
          if (this.isProcessing) {
            const delay = this.calculateDelay();
            console.log(`⏰ Waiting ${delay / 1000} seconds before next batch...\n`);
            await this.sleep(delay);

            // Process next batch
            if (this.isProcessing) {
              this.processQueue();
            }
          }
          return;
        }
      }

      // Fallback to sequential processing (original behavior)
      const email = this.getNextEmail();

      if (!email) {
        // No emails to process (or no scheduled ones ready)
        return; // Silent return
      }

      // Silent processing

      // Get next sender
      const sender = this.getNextSender();

      if (!sender) {
        return; // Silent return - no active senders
      }

      // Send the email
      await this.processSingleEmail(email, sender);

      // Wait before next email
      if (this.isProcessing) {
        let takingBreak = (this.emailsSentInBatch >= this.batchSize);
        const delay = this.calculateDelay();

        if (takingBreak) {
          await this.completeCycle();
        }

        await this.sleep(delay);

        // Process next email loop
        if (this.isProcessing) {
          this.processQueue();
        }
      }
    } catch (error) {
      // Global error handler - catch any unexpected errors
      // Log error to database for debugging
      try {
        db.run(
          `INSERT INTO worker_errors (error_type, error_message, stack_trace, created_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          ["processQueue", error.message, error.stack]
        );
      } catch (logError) {
        // Silently ignore logging errors
      }

      // DON'T set isProcessing = false - let the interval keep trying
      // The worker will automatically retry on the next interval
    }
  }

  /**
   * Complete a full cycle
   */
  async completeCycle() {
    this.emailsSentInBatch = 0;
  }

  /**
   * Get queue settings from database
   */
  getSettings() {
    try {
      const rows = db.all("SELECT key, value FROM email_settings");
      const settings = {};
      rows.forEach((r) => {
        settings[r.key] = parseFloat(r.value);
      });
      return {
        perEmailDelay: (settings.per_email_delay || 60) * 1000, // convert to ms
        cycleCooldownMin: (settings.cycle_cooldown_min || 10) * 60 * 1000, // convert to ms
        cycleCooldownMax: (settings.cycle_cooldown_max || 13) * 60 * 1000, // convert to ms
      };
    } catch (e) {
      // Fallback to defaults if DB read fails
      return {
        perEmailDelay: 60 * 1000,
        cycleCooldownMin: 10 * 60 * 1000,
        cycleCooldownMax: 13 * 60 * 1000,
      };
    }
  }

  /**
   * Calculate delay before next email (reads from DB settings)
   */
  calculateDelay() {
    const settings = this.getSettings();

    // If we hit the batch limit, take the bigger breath break
    if (this.emailsSentInBatch >= this.batchSize) {
      const range = settings.cycleCooldownMax - settings.cycleCooldownMin;
      const randomDelay = Math.floor(Math.random() * range);
      return settings.cycleCooldownMin + randomDelay;
    }

    // Standard short delay between consecutive batch emails
    return settings.perEmailDelay;
  }

  /**
   * Create worker_errors table for debugging
   */
  createErrorTable() {
    try {
      db.run(`
        CREATE TABLE IF NOT EXISTS worker_errors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          error_type TEXT NOT NULL,
          error_message TEXT NOT NULL,
          stack_trace TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Silent initialization
    } catch (error) {
      // Silent error handling
    }
  }

  /**
   * Get worker health status (enhanced with timezone info)
   */
  getHealthStatus() {
    const senders = this.getActiveSenders();
    const queuedEmails = db.all(
      `SELECT COUNT(*) as count FROM email_queue WHERE status = 'queued'`
    )[0].count;

    const recentErrors = db.all(
      `SELECT * FROM worker_errors
       WHERE created_at >= datetime('now', '-1 hour')
       ORDER BY created_at DESC LIMIT 10`
    );

    // Get countries in business hours
    let countriesInBusiness = [];
    try {
      countriesInBusiness = timezoneScheduler.getCountriesInBusiness();
    } catch (e) {
      // Ignore
    }

    return {
      isRunning: this.isProcessing,
      isPaused: this.isPaused,
      activeSenders: senders.length,
      queuedEmails: queuedEmails,
      recentErrors: recentErrors,
      uptime: this.checkInterval ? "active" : "stopped",
      lastCheck: new Date().toISOString(),
      // Enhanced: timezone info
      countriesInBusiness: countriesInBusiness.map(c => ({
        code: c.country,
        name: c.name,
        timezone: c.timezone
      })),
      parallelMode: this.parallelMode
    };
  }

  /**
   * Get queue statistics (enhanced with timezone breakdown)
   */
  getStats() {
    const senders = this.getActiveSenders();

    // Get queue breakdown by timezone/country
    const queueByCountry = db.all(`
      SELECT
        COALESCE(s.country, 'unknown') as country,
        COUNT(eq.id) as count
      FROM email_queue eq
      LEFT JOIN contacts c ON eq.contact_id = c.id
      LEFT JOIN sites s ON c.site_id = s.id
      WHERE eq.status = 'queued'
      GROUP BY COALESCE(s.country, 'unknown')
      ORDER BY count DESC
    `);

    // Mark which countries are in business hours
    const countriesInBusiness = this.getCountriesInBusiness();
    const queueWithStatus = queueByCountry.map(item => ({
      ...item,
      inBusinessHours: countriesInBusiness.includes(item.country.toLowerCase())
    }));

    return {
      queue: {
        total: db.all(
          `SELECT COUNT(*) as count FROM email_queue WHERE status = 'queued'`,
        )[0].count,
        isProcessing: this.isProcessing,
        byCountry: queueWithStatus
      },
      sent: {
        total: db.all(
          `SELECT COUNT(*) as count FROM email_queue WHERE status = 'sent'`,
        )[0].count,
        today: senders.reduce((sum, s) => sum + s.sent_today, 0),
      },
      failed: db.all(
        `SELECT COUNT(*) as count FROM email_queue WHERE status = 'failed'`,
      )[0].count,
      cycles: {
        completed: Math.floor(
          db.all(
            `SELECT COUNT(*) as count FROM email_queue WHERE status = 'sent'`,
          )[0].count / senders.length,
        ),
      },
      accounts: senders.map((s) => ({
        id: s.id,
        name: s.name,
        sentToday: s.sent_today,
        dailyLimit: s.daily_limit,
      })),
      status: {
        isProcessing: this.isProcessing,
        isPaused: this.isPaused,
        currentAccountIndex: this.currentSenderIndex,
        emailsSentInBatch: this.emailsSentInBatch,
        batchSize: this.batchSize,
        parallelMode: this.parallelMode,
        scheduledItemsCount: db.all(
          `SELECT COUNT(*) as count FROM email_queue WHERE status = 'queued' AND scheduled_at IS NOT NULL AND scheduled_at > CURRENT_TIMESTAMP`,
        )[0].count,
      },
    };
  }

  /**
   * Toggle parallel mode
   */
  toggleParallelMode(enabled) {
    this.parallelMode = enabled;
    console.log(`Parallel sending mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton
const worker = new EmailQueueWorker();

module.exports = worker;
