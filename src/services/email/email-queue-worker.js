/**
 * Email Queue Worker - Enhanced
 *
 * REFACTORED: Now uses PostgreSQL adapter with async/await
 *
 * Processes emails from the queue using:
 * - Timezone-aware prioritization (countries in business hours first)
 * - Parallel sending per sender
 * - Round-robin distribution
 */

const nodemailer = require("nodemailer");
const db = require("../../database/database.js");
const timezoneScheduler = require("./timezone-scheduler");
const logger = require("../../utils/logger"); // Compact logger

/**
 * Validate and reschedule an email if its scheduled time is outside business hours
 * Returns true if the email should be sent, false if it was rescheduled
 * REFACTORED: Now async, uses PostgreSQL adapter
 */
async function validateScheduledTime(email) {
  const countryCode = email.country_code || email.site_country || 'in';
  const scheduledAt = email.scheduled_at ? new Date(email.scheduled_at) : null;

  if (!scheduledAt) {
    // No scheduled time - this is legacy data, check current time
    const now = new Date();
    if (!timezoneScheduler.isBusinessHour(now, countryCode)) {
      // Reschedule to next business hour
      const nextValidTime = timezoneScheduler.calculateFirstSendTime(countryCode);
      await db.run(
        "UPDATE email_queue SET scheduled_at = ? WHERE id = ?",
        [nextValidTime.toISOString(), email.id]
      );
      logger.email('Rescheduled', { to: email.recipient_email, time: nextValidTime.toISOString() });
      return false;
    }
    return true;
  }

  // Check if the scheduled time is actually within business hours
  if (!timezoneScheduler.isBusinessHour(scheduledAt, countryCode)) {
    // Reschedule to next valid business hour
    const nextValidTime = timezoneScheduler.adjustToBusinessHours(scheduledAt, countryCode);
    await db.run(
      "UPDATE email_queue SET scheduled_at = ? WHERE id = ?",
      [nextValidTime.toISOString(), email.id]
    );
    logger.email('Schedule adjusted', { to: email.recipient_email, time: nextValidTime.toISOString() });
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
 * REFACTORED: Now async, uses PostgreSQL adapter
 */
async function scheduleEmail(email) {
  const countryCode = email.country_code || email.site_country || 'in';
  const now = new Date();

  // For sequence emails, we need to calculate based on previous email in the sequence
  if (email.tag && email.sequence_position > 1) {
    // This is a follow-up email - find the previous email in the sequence
    const previousEmail = await db.get(`
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
    const gapSetting = await db.get(
      `SELECT value FROM email_settings WHERE key = ?`,
      [`followup_gap_${email.sequence_position - 1}`]
    );
    const gapDays = gapSetting ? parseInt(gapSetting.value) : (email.sequence_position === 2 ? 2 : 5);

    // Calculate follow-up date
    const scheduledAt = timezoneScheduler.calculateFollowUpDate(baseTime, gapDays, countryCode);

    await db.run(
      "UPDATE email_queue SET scheduled_at = ? WHERE id = ?",
      [scheduledAt.toISOString(), email.id]
    );

    // Check if scheduled time has arrived
    return scheduledAt <= now;
  }

  // For regular emails or if sequence logic failed, schedule for next business time
  const firstSendTime = timezoneScheduler.calculateFirstSendTime(countryCode);

  await db.run(
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
      logger.warn('EmailQueue', 'Already running');
      return;
    }

    this.isProcessing = true;
    logger.worker('EmailQueue', 'started', {
      interval: '30s',
      batch: 5,
      delay: '60s',
      cooldown: '10-13m',
      parallel: this.parallelMode ? 'yes' : 'no'
    });

    // Create worker_errors table if not exists
    this.createErrorTable();

    // Check for active senders
    this.getActiveSenders().then(senders => {
      if (senders.length === 0) {
        logger.warn('EmailQueue', 'No active senders');
      } else {
        logger.email('Active senders', { count: senders.length });
      }
    });

    // Process immediately
    this.processQueue();

    // Check every 30 seconds for new emails
    this.checkInterval = setInterval(() => {
      // Always try to process, even if isProcessing is false (recovery mechanism)
      if (!this.isProcessing && !this.isPaused) {
        this.isProcessing = true;
        this.processQueue();
      }
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
    logger.worker('EmailQueue', 'stopped');
  }

  /**
   * Pause processing (keeps worker alive but stops picking new items)
   */
  pause() {
    this.isPaused = true;
    this.isProcessing = false;
    logger.email('Queue paused');
  }

  /**
   * Resume processing after pause
   */
  resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.isProcessing = true;
      this.processQueue();
      logger.email('Queue resumed');
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
    logger.email('Queue triggered');
    return { success: true, message: "Queue processing started immediately" };
  }

  /**
   * Get active sender accounts
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async getActiveSenders() {
    try {
      const senders = await db.all(`
        SELECT * FROM email_senders
        WHERE is_active = 1
        ORDER BY created_at ASC
      `);
      return senders;
    } catch (error) {
      logger.error('DB', 'Get senders failed', { message: error.message });
      return [];
    }
  }

  /**
   * Get countries currently in business hours
   */
  getCountriesInBusiness() {
    try {
      return timezoneScheduler.getCountriesInBusiness().map(c => c.country);
    } catch (error) {
      // Silently ignore timezone errors
      return [];
    }
  }

  /**
   * Get next email with timezone-aware prioritization
   * Prioritizes emails for countries currently in business hours
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async getNextEmail() {
    try {
      const countriesInBusiness = this.getCountriesInBusiness();
      const now = new Date().toISOString();

      // First, try to get emails for countries in business hours
      if (countriesInBusiness.length > 0) {
        const placeholders = countriesInBusiness.map((_, i) => `$${i + 2}`).join(',');
        const businessHoursEmail = await db.get(
          `
          SELECT eq.*,
                 s.country as site_country,
                 s.url as site_url
          FROM email_queue eq
          LEFT JOIN contacts c ON eq.contact_id = c.id
          LEFT JOIN sites s ON c.site_id = s.id
          WHERE eq.status = 'queued'
            AND (eq.scheduled_at IS NULL OR eq.scheduled_at <= $1)
            AND s.country IN (${placeholders})
          ORDER BY eq.created_at ASC
          LIMIT 1
          `,
          [now, ...countriesInBusiness.map(c => c.toUpperCase())],
        );

        if (businessHoursEmail) {
          // Priority country logged per-email in processSingleEmail
          return businessHoursEmail;
        }
      }

      // Fallback: get any queued email that's due (already has scheduled_at)
      let email = await db.get(
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
          AND eq.scheduled_at <= $1
        ORDER BY eq.created_at ASC
        LIMIT 1
        `,
        [now],
      );

      // If no scheduled emails are due, check for unscheduled emails and schedule them
      if (!email) {
        email = await db.get(
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
          const shouldSendNow = await scheduleEmail(email);

          // If it's scheduled for later, don't return it (not ready to send)
          if (!shouldSendNow) {
            // Email scheduled for later - silent
            return null;
          }
        }
      }

      return email;
    } catch (error) {
      logger.error('DB', 'Get next email failed', { message: error.message });
      return null;
    }
  }

  /**
   * Get next batch of emails for parallel processing
   * Returns up to N emails that can be sent concurrently to different senders
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async getNextEmailBatch(maxBatchSize = 3) {
    try {
      const countriesInBusiness = this.getCountriesInBusiness();
      const now = new Date().toISOString();
      const senders = await this.getActiveSenders();

      if (senders.length === 0) return [];

      // Build batch with available senders
      const batch = [];
      const usedSenders = new Set();

      // First, prioritize business hours emails
      // NOTE: Don't filter by sent_today >= daily_limit here - that check is non-atomic
      // The actual limit check happens atomically in reserveSenderSlot() during processing
      for (const sender of senders) {
        if (batch.length >= maxBatchSize) break;
        if (usedSenders.has(sender.id)) continue;
        // Skip inactive senders (still safe to check, doesn't change)
        if (!sender.is_active) continue;

        const activeCount = this.activeSendsPerSender.get(sender.id) || 0;
        if (activeCount >= this.maxParallelPerSender) continue;

        let email;
        if (countriesInBusiness.length > 0) {
          // Try business hours first
          const placeholders = countriesInBusiness.map((_, i) => `$${i + 3}`).join(',');
          email = await db.get(
            `
            SELECT eq.*,
                   s.country as site_country
            FROM email_queue eq
            LEFT JOIN sites s ON eq.contact_id = (
              SELECT site_id FROM contacts WHERE id = eq.contact_id LIMIT 1
            )
            WHERE eq.status = 'queued'
              AND eq.scheduled_at IS NOT NULL
              AND eq.scheduled_at <= $1
              AND s.country IN (${placeholders})
            ORDER BY eq.created_at ASC
            LIMIT 1
            `,
            [now, ...countriesInBusiness.map(c => c.toUpperCase())],
          );
        }

        // If no business hours email available, try any scheduled email that's due
        if (!email) {
          email = await db.get(
            `
            SELECT eq.*,
                   s.country as site_country
            FROM email_queue eq
            LEFT JOIN sites s ON eq.contact_id = (
              SELECT site_id FROM contacts WHERE id = eq.contact_id LIMIT 1
            )
            WHERE eq.status = 'queued'
              AND eq.scheduled_at IS NOT NULL
              AND eq.scheduled_at <= $1
            ORDER BY eq.created_at ASC
            LIMIT 1
            `,
            [now],
          );
        }

        // If still no email, try to schedule an unscheduled one
        if (!email) {
          email = await db.get(
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
            const shouldSendNow = await scheduleEmail(email);
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
          await db.run("UPDATE email_queue SET status = 'sending' WHERE id = ?", [email.id]);
        }
      }

      return batch;
    } catch (error) {
      logger.error('DB', 'Get batch failed', { message: error.message });
      return [];
    }
  }

  /**
   * Reset daily counters if needed
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async checkDailyReset() {
    try {
      const today = new Date().toDateString();
      const senders = await db.all("SELECT * FROM email_senders");

      for (const sender of senders) {
        if (sender.last_reset_date !== today) {
          await db.run(
            `
            UPDATE email_senders
            SET sent_today = 0,
                last_reset_date = $1
            WHERE id = $2
          `,
            [today, sender.id]
          );
          // Daily counter reset - silent
        }
      }
    } catch (error) {
      logger.error('DB', 'Daily reset failed', { message: error.message });
    }
  }

  /**
   * Get next sender in round-robin
   * NOTE: This now just returns the next active sender without checking daily limit.
   * The actual limit check happens atomically in reserveSenderSlot() during processing.
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async getNextSender() {
    try {
      const senders = await this.getActiveSenders();

      if (senders.length === 0) {
        logger.error('Email', 'No active senders');
        return null;
      }

      // Return next active sender (daily limit check happens atomically later)
      const sender = senders[this.currentSenderIndex];
      this.currentSenderIndex = (this.currentSenderIndex + 1) % senders.length;
      return sender;
    } catch (error) {
      logger.error('DB', 'Get sender failed', { message: error.message });
      return null;
    }
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
   * Reserve a sender slot atomically - check and increment daily limit in a transaction
   * This prevents multiple workers from exceeding the limit simultaneously
   * Returns { success: true, sender } if slot reserved, { success: false, reason } if not
   * REFACTORED: Now async, uses PostgreSQL adapter with transaction
   */
  async reserveSenderSlot(senderId) {
    try {
      return await db.transaction(async (tx) => {
        // Lock the sender row with FOR UPDATE to prevent concurrent modifications
        const sender = await tx.get(
          `SELECT id, email, name, service, smtp_host, smtp_port, smtp_user, password,
                  sent_today, daily_limit, is_active
           FROM email_senders
           WHERE id = $1
           FOR UPDATE`,
          [senderId]
        );

        if (!sender) {
          throw new Error(`Sender ${senderId} not found`);
        }

        if (!sender.is_active) {
          return { success: false, reason: 'sender_inactive', sender };
        }

        if (sender.sent_today >= sender.daily_limit) {
          return { success: false, reason: 'daily_limit_reached', sender };
        }

        // Atomically increment the counter within the locked transaction
        await tx.run(
          `UPDATE email_senders SET sent_today = sent_today + 1 WHERE id = $1`,
          [senderId]
        );

        return { success: true, sender };
      });
    } catch (error) {
      logger.error('Email', 'Reserve slot failed', { message: error.message });
      return { success: false, reason: 'transaction_failed', error: error.message };
    }
  }

  /**
   * Process a single email send with error handling
   * REFACTORED: Now async, uses PostgreSQL adapter with atomic daily limit checking
   */
  async processSingleEmail(email, sender) {
    // First, validate scheduled time is within business hours (no DB write yet)
    if (!(await validateScheduledTime(email))) {
      return { success: false, rescheduled: true };
    }

    // Reserve the sender slot atomically - this checks AND increments daily_limit
    const reservation = await this.reserveSenderSlot(sender.id);

    if (!reservation.success) {
      if (reservation.reason === 'daily_limit_reached') {
        // Sender reached limit - mark email as queued for retry later
        await db.run(
          `UPDATE email_queue SET status = 'queued' WHERE id = $1`,
          [email.id]
        );
        logger.warn('Email', 'Sender limit reached', { senderId: sender.id });
        return { success: false, reason: 'limit_reached' };
      }
      // Other failure reasons
      logger.error('Email', 'Slot reservation failed', { reason: reservation.reason });
      return { success: false, reason: reservation.reason };
    }

    // We have the slot reserved - get the updated sender data
    const reservedSender = reservation.sender;

    try {
      // Send the actual email
      const result = await this.sendEmail(reservedSender, email);

      if (result.success) {
        // Update queue item as sent
        await db.run(
          `UPDATE email_queue
           SET status = 'sent',
               sender_id = $1,
               sent_at = CURRENT_TIMESTAMP,
               attempts = attempts + 1
           WHERE id = $2`,
          [reservedSender.id, email.id]
        );

        // Update contact send log history
        if (email.contact_id && email.campaign_id) {
          try {
            // Convert sequence_position (1, 2, 3...) to send_type (main, followup_1, followup_2...)
            const sequencePos = email.sequence_position || 1;
            const sendType =
              sequencePos === 1 ? "main" : `followup_${sequencePos - 1}`;

            await db.run(
              `UPDATE email_send_log
               SET status = 'sent', sent_at = CURRENT_TIMESTAMP
               WHERE contact_id = $1 AND campaign_id = $2 AND send_type = $3`,
              [email.contact_id, email.campaign_id, sendType]
            );
          } catch (logError) {
            // Silently ignore log history errors
          }
        }

        // Update campaign counter
        if (email.campaign_id) {
          await db.run(
            `UPDATE email_campaigns SET sent_count = sent_count + 1 WHERE id = $1`,
            [email.campaign_id]
          );
        }

        logger.email('Sent', { to: email.recipient_email });
        this.emailsSentInBatch++;
        return { success: true };
      } else {
        // Email send failed - but we already incremented the counter
        // We need to revert it since no email was actually sent
        await db.run(
          `UPDATE email_senders SET sent_today = sent_today - 1 WHERE id = $1`,
          [reservedSender.id]
        );

        // Update queue item with error
        const newAttempts = (email.attempts || 0) + 1;

        if (newAttempts >= 3) {
          await db.run(
            `UPDATE email_queue
             SET status = 'failed', error_message = $1, attempts = $2
             WHERE id = $3`,
            [result.error, newAttempts, email.id]
          );

          // Update campaign counter
          if (email.campaign_id) {
            await db.run(
              `UPDATE email_campaigns SET failed_count = failed_count + 1 WHERE id = $1`,
              [email.campaign_id]
            );
          }

          logger.error('Email', 'Failed after 3 attempts', { to: email.recipient_email, error: result.error });
        } else {
          const rescheduleTime = new Date();
          rescheduleTime.setMinutes(rescheduleTime.getMinutes() + 15);
          await db.run(
            `UPDATE email_queue
             SET status = 'queued', attempts = $1, error_message = $2, scheduled_at = $3
             WHERE id = $4`,
            [newAttempts, result.error, rescheduleTime.toISOString(), email.id]
          );

          logger.error('Email', 'Rescheduled', { attempt: newAttempts, error: result.error });
        }
        return { success: false, error: result.error };
      }
    } catch (error) {
      // Unexpected error - revert the counter increment
      await db.run(
        `UPDATE email_senders SET sent_today = GREATEST(sent_today - 1, 0) WHERE id = $1`,
        [reservedSender.id]
      );

      logger.error('Email', 'Process failed', { message: error.message });
      return { success: false, error: error.message };
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
      await this.checkDailyReset();

      // Try parallel batch processing first
      if (this.parallelMode) {
        const batch = await this.getNextEmailBatch(3);

        if (batch.length > 0) {
          logger.email('Processing batch', { count: batch.length });

          // Track active sends
          batch.forEach(({ sender }) => {
            this.activeSendsPerSender.set(
              sender.id,
              (this.activeSendsPerSender.get(sender.id) || 0) + 1
            );
          });

          // Process all emails in parallel
          const promises = batch.map(({ email, sender }) => {
            return this.processSingleEmail(email, sender);
          });

          const results = await Promise.all(promises);

          // Handle rescheduled emails - don't count them as failures
          const rescheduledCount = results.filter(r => r && r.rescheduled).length;

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
      const email = await this.getNextEmail();

      if (!email) {
        // No emails to process (or no scheduled ones ready)
        logger.poll('EmailQueue', { queued: 0 });
        return;
      }

      // Get next sender
      const sender = await this.getNextSender();

      if (!sender) {
        logger.warn('Email', 'All senders at limit');
        return;
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
      logger.error('Email', 'Queue error', { message: error.message });

      // Log error to database for debugging
      try {
        await db.run(
          `INSERT INTO worker_errors (error_type, error_message, stack_trace, created_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
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
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async getSettings() {
    try {
      const rows = await db.all("SELECT key, value FROM email_settings");
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
   * REFACTORED: Now async
   */
  async calculateDelay() {
    const settings = await this.getSettings();

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
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async createErrorTable() {
    try {
      await db.run(`
        CREATE TABLE IF NOT EXISTS worker_errors (
          id SERIAL PRIMARY KEY,
          error_type TEXT NOT NULL,
          error_message TEXT NOT NULL,
          stack_trace TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      // Silently ignore table creation errors
    }
  }

  /**
   * Get worker health status (enhanced with timezone info)
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async getHealthStatus() {
    try {
      const senders = await this.getActiveSenders();
      const queuedResult = await db.get(
        `SELECT COUNT(*) as count FROM email_queue WHERE status = 'queued'`
      );
      const queuedEmails = queuedResult?.count || 0;

      const recentErrors = await db.all(
        `SELECT * FROM worker_errors
         WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
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
    } catch (error) {
      // Health status error - silent
      return {
        isRunning: this.isProcessing,
        isPaused: this.isPaused,
        activeSenders: 0,
        queuedEmails: 0,
        recentErrors: [],
        uptime: "error",
        lastCheck: new Date().toISOString(),
        countriesInBusiness: [],
        parallelMode: this.parallelMode
      };
    }
  }

  /**
   * Get queue statistics (enhanced with timezone breakdown)
   * REFACTORED: Now async, uses PostgreSQL adapter
   */
  async getStats() {
    try {
      const senders = await this.getActiveSenders();

      // Get queue breakdown by timezone/country
      const queueByCountry = await db.all(`
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

      // Get various counts
      const queueTotalResult = await db.get(
        `SELECT COUNT(*) as count FROM email_queue WHERE status = 'queued'`
      );
      const sentTotalResult = await db.get(
        `SELECT COUNT(*) as count FROM email_queue WHERE status = 'sent'`
      );
      const failedResult = await db.get(
        `SELECT COUNT(*) as count FROM email_queue WHERE status = 'failed'`
      );
      const sentResult = await db.get(
        `SELECT COUNT(*) as count FROM email_queue WHERE status = 'sent'`
      );
      const scheduledItemsResult = await db.get(
        `SELECT COUNT(*) as count FROM email_queue WHERE status = 'queued' AND scheduled_at IS NOT NULL AND scheduled_at > CURRENT_TIMESTAMP`
      );

      return {
        queue: {
          total: queueTotalResult?.count || 0,
          isProcessing: this.isProcessing,
          byCountry: queueWithStatus
        },
        sent: {
          total: sentTotalResult?.count || 0,
          today: senders.reduce((sum, s) => sum + s.sent_today, 0),
        },
        failed: failedResult?.count || 0,
        cycles: {
          completed: Math.floor(
            (sentResult?.count || 0) / senders.length,
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
          scheduledItemsCount: scheduledItemsResult?.count || 0,
        },
      };
    } catch (error) {
      // Stats error - silent
      return {
        queue: { total: 0, isProcessing: this.isProcessing, byCountry: [] },
        sent: { total: 0, today: 0 },
        failed: 0,
        cycles: { completed: 0 },
        accounts: [],
        status: {
          isProcessing: this.isProcessing,
          isPaused: this.isPaused,
          currentAccountIndex: this.currentSenderIndex,
          emailsSentInBatch: this.emailsSentInBatch,
          batchSize: this.batchSize,
          parallelMode: this.parallelMode,
          scheduledItemsCount: 0,
        },
      };
    }
  }

  /**
   * Toggle parallel mode
   */
  toggleParallelMode(enabled) {
    this.parallelMode = enabled;
    // Parallel mode changed - silent
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
