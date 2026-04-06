/**
 * Sequence Manager
 *
 * Implements the event-driven sequence chain design from PRODUCTION_ARCHITECTURE_CORRECTED.md
 *
 * Key principles:
 * 1. Only schedule next email AFTER previous was successfully sent
 * 2. Use transactions for atomic state updates
 * 3. Handle worker crashes with recovery mechanism
 * 4. Mark sequences as failed on permanent failures
 */

import type {
  DatabasePool,
  EmailQueue,
  EmailTemplate,
  InitializeSequenceResult,
  OnEmailSentResult,
  QueueItem,
  RecoveryResult,
  SequenceConfig,
  SequenceState,
  SequenceStatus,
  Transaction,
} from './types.js';

export class SequenceManager {
  private db: DatabasePool;
  private emailQueue: EmailQueue;
  private config: SequenceConfig;

  constructor(db: DatabasePool, emailQueue: EmailQueue, config?: Partial<SequenceConfig>) {
    this.db = db;
    this.emailQueue = emailQueue;
    this.config = {
      defaultFollowUpDelayMs: 24 * 60 * 60 * 1000, // 24 hours default
      stuckJobTimeoutMs: 10 * 60 * 1000, // 10 minutes
      maxRecoveryAttempts: 3,
      ...config,
    };
  }

  /**
   * Initialize sequence state for a contact
   *
   * Creates or resets the sequence state for a contact/campaign/tag combination.
   * This should be called when queuing the first email of a sequence.
   *
   * @param trx - Active transaction
   * @param contactId - Contact ID
   * @param campaignId - Campaign ID
   * @param sequenceTag - Sequence tag (e.g., 'sales-sequence-1')
   * @returns Sequence state and info about first email
   */
  async initializeSequence(
    trx: Transaction,
    contactId: number,
    campaignId: number,
    sequenceTag: string
  ): Promise<SequenceState> {
    // Get max position for this tag
    const maxResult = await trx.query(
      `SELECT MAX(sequence_number) as max_pos
       FROM email_templates
       WHERE tags @> ARRAY[$1] AND is_active = TRUE`,
      [sequenceTag]
    );

    const maxPosition = maxResult.rows[0]?.max_pos || 1;

    // Create or reset sequence state
    const result = await trx.query(
      `INSERT INTO email_sequence_state (
        contact_id, campaign_id, sequence_tag,
        current_position, max_position, status
      ) VALUES ($1, $2, $3, 0, $4, 'active')
      ON CONFLICT (contact_id, campaign_id, sequence_tag)
      DO UPDATE SET
        current_position = 0,
        status = 'active',
        max_position = $4,
        current_queue_id = NULL,
        last_failed_position = NULL,
        last_failed_at = NULL,
        failure_reason = NULL,
        updated_at = NOW()
      RETURNING *`,
      [contactId, campaignId, sequenceTag, maxPosition]
    );

    return result.rows[0];
  }

  /**
   * Handle successful email send in sequence
   *
   * This is the CORE method that advances the sequence.
   * Only called AFTER email was successfully sent.
   *
   * Event-driven chain:
   * 1. Update sequence state to new position
   * 2. Check if there are more emails in sequence
   * 3. If yes, create next queue item and schedule it
   * 4. If no, mark sequence as completed
   *
   * @param trx - Active transaction (will be committed by caller)
   * @param queueItem - The queue item that was just sent
   * @param messageId - Provider message ID from sent email
   * @returns Result with advancement info
   */
  async onEmailSent(
    trx: Transaction,
    queueItem: QueueItem,
    messageId: string
  ): Promise<OnEmailSentResult> {
    const { contact_id, campaign_id, sequence_tag, sequence_position, id } = queueItem;

    // Skip if not part of a sequence
    if (!sequence_tag || sequence_position === 0) {
      return { advanced: false };
    }

    // Update sequence state to new position
    const stateResult = await trx.query(
      `UPDATE email_sequence_state
       SET
         current_position = $2,
         current_queue_id = NULL,
         updated_at = NOW()
       WHERE contact_id = $1
         AND campaign_id = $3
         AND sequence_tag = $4
       RETURNING *`,
      [contact_id, sequence_position, campaign_id, sequence_tag]
    );

    const state = stateResult.rows[0];
    if (!state) {
      // Sequence state not found - create it
      await this.initializeSequence(trx, contact_id, campaign_id, sequence_tag);
      return { advanced: false };
    }

    // Check if sequence is complete
    if (state.current_position >= state.max_position) {
      await trx.query(
        `UPDATE email_sequence_state
         SET status = 'completed', updated_at = NOW()
         WHERE id = $1`,
        [state.id]
      );
      return { advanced: true, sequenceCompleted: true };
    }

    // Schedule next email in sequence
    return await this.scheduleNext(trx, state, queueItem);
  }

  /**
   * Handle email failure in sequence
   *
   * Determines if failure is permanent (marks sequence as failed)
   * or transient (will retry).
   *
   * @param trx - Active transaction (null if outside transaction)
   * @param queueItem - The queue item that failed
   * @param error - Error message
   * @param isPermanent - Whether this is a permanent failure
   */
  async onEmailFailed(
    trx: Transaction | null,
    queueItem: QueueItem,
    error: string,
    isPermanent: boolean
  ): Promise<void> {
    const { contact_id, campaign_id, sequence_tag, sequence_position, attempts, max_attempts } = queueItem;

    // Determine if this should permanently fail the sequence
    const shouldFailSequence = isPermanent || attempts >= max_attempts;

    if (shouldFailSequence) {
      const query = `
        UPDATE email_sequence_state
        SET
          status = 'failed',
          last_failed_position = $2,
          last_failed_at = NOW(),
          failure_reason = $3,
          updated_at = NOW()
        WHERE contact_id = $1
          AND campaign_id = $4
          AND sequence_tag = $5
      `;

      if (trx) {
        await trx.query(query, [contact_id, sequence_position, error, campaign_id, sequence_tag]);
      } else {
        await this.db.query(query, [contact_id, sequence_position, error, campaign_id, sequence_tag]);
      }
    }
    // For transient failures, we don't update sequence state - retry will happen
  }

  /**
   * Schedule the next email in a sequence
   *
   * Private method that:
   * 1. Finds the next template in sequence
   * 2. Creates a new queue item
   * 3. Updates sequence state with current_queue_id
   * 4. Adds to BullMQ with appropriate delay
   *
   * @param trx - Active transaction
   * @param state - Current sequence state
   * @param previousItem - The previous queue item (just sent)
   * @returns Result with next email info
   */
  private async scheduleNext(
    trx: Transaction,
    state: SequenceState,
    previousItem: QueueItem
  ): Promise<OnEmailSentResult> {
    const nextPosition = state.current_position + 1;

    // Get the template for next position
    const templateResult = await trx.query(
      `SELECT * FROM email_templates
       WHERE tags @> ARRAY[$1]
         AND sequence_number = $2
         AND is_active = TRUE
       LIMIT 1`,
      [state.sequence_tag, nextPosition]
    );

    const template = templateResult.rows[0] as EmailTemplate | undefined;
    if (!template) {
      // No template found - mark sequence as completed
      await trx.query(
        `UPDATE email_sequence_state
         SET status = 'completed', updated_at = NOW()
         WHERE id = $1`,
        [state.id]
      );
      return { advanced: true, sequenceCompleted: true };
    }

    // Calculate scheduled time (default: 24 hours from now)
    const scheduledAt = new Date(Date.now() + this.config.defaultFollowUpDelayMs);

    // Create new queue item
    const queueResult = await trx.query(
      `INSERT INTO email_queue (
        contact_id, campaign_id, sender_id, template_id,
        recipient_email, subject, html_content, text_content,
        sequence_tag, sequence_position, depends_on_queue_id,
        status, scheduled_at, priority, country_code
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        'scheduled', $12, $13, $14
      ) RETURNING *`,
      [
        state.contact_id,
        state.campaign_id,
        previousItem.sender_id,
        template.id,
        previousItem.recipient_email,
        template.subject,
        template.html_content,
        template.text_content,
        state.sequence_tag,
        nextPosition,
        previousItem.id, // depends_on previous email
        scheduledAt,
        previousItem.priority,
        previousItem.country_code,
      ]
    );

    const newQueueItem = queueResult.rows[0];

    // Update sequence state with current queue ID
    await trx.query(
      `UPDATE email_sequence_state
       SET current_queue_id = $2
       WHERE id = $1`,
      [state.id, newQueueItem.id]
    );

    // Add to BullMQ with delay
    const delay = scheduledAt.getTime() - Date.now();
    await this.emailQueue.add('send-email', {
      queueItemId: newQueueItem.id,
      contactId: state.contact_id,
      countryCode: previousItem.country_code,
    }, {
      jobId: `email-${newQueueItem.id}`,
      delay: delay > 0 ? delay : 0,
    });

    return {
      advanced: true,
      nextPosition,
      nextScheduledAt: scheduledAt,
      nextQueueId: newQueueItem.id,
    };
  }

  /**
   * Recover sequences stuck in 'acquired' state
   *
   * Handles worker crashes by finding jobs that were acquired but never
   * completed (status='acquired' for longer than timeout).
   *
   * Recovery process:
   * 1. Find queue items stuck in 'acquired' state
   * 2. Reset them to 'scheduled' status
   * 3. Clear processing tokens
   * 4. Increment attempt counter
   * 5. Re-add to BullMQ
   *
   * @returns Recovery result with count and details
   */
  async recoverStuckSequences(): Promise<RecoveryResult> {
    const trx = await this.db.beginTransaction();

    try {
      // Find stuck queue items
      const result = await trx.query(
        `UPDATE email_queue
         SET
           status = 'scheduled',
           processing_token = NULL,
           attempts = attempts + 1,
           last_error = 'Recovery: Worker crashed during processing',
           last_error_at = NOW()
         WHERE status = 'acquired'
           AND started_at < NOW() - INTERVAL '1 millisecond' * $1
         RETURNING id, contact_id, sequence_tag, sequence_position`,
        [this.config.stuckJobTimeoutMs]
      );

      const recovered = result.rows;
      const details: RecoveryResult['details'] = [];

      // Also reset sequence states that were stuck
      const sequenceResult = await trx.query(
        `UPDATE email_sequence_state
         SET current_queue_id = NULL
         WHERE current_queue_id = ANY($1)
         RETURNING id`,
        [recovered.map((r: any) => r.id)]
      );

      await trx.commit();

      // Re-add to queue
      for (const item of recovered) {
        await this.emailQueue.add('send-email', {
          queueItemId: item.id,
          contactId: item.contact_id,
        }, {
          jobId: `email-${item.id}`,
        });

        details.push({
          queueId: item.id,
          contactId: item.contact_id,
          reason: 'Stuck in acquired state',
        });
      }

      return {
        recoveredCount: recovered.length,
        sequenceStatesReset: sequenceResult.rows.length,
        details,
      };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  /**
   * Pause an active sequence
   *
   * @param contactId - Contact ID
   * @param campaignId - Campaign ID
   * @param sequenceTag - Sequence tag
   */
  async pauseSequence(
    contactId: number,
    campaignId: number,
    sequenceTag: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE email_sequence_state
       SET status = 'paused', updated_at = NOW()
       WHERE contact_id = $1
         AND campaign_id = $2
         AND sequence_tag = $3`,
      [contactId, campaignId, sequenceTag]
    );
  }

  /**
   * Resume a paused sequence
   *
   * @param contactId - Contact ID
   * @param campaignId - Campaign ID
   * @param sequenceTag - Sequence tag
   */
  async resumeSequence(
    contactId: number,
    campaignId: number,
    sequenceTag: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE email_sequence_state
       SET status = 'active', updated_at = NOW()
       WHERE contact_id = $1
         AND campaign_id = $2
         AND sequence_tag = $3`,
      [contactId, campaignId, sequenceTag]
    );
  }

  /**
   * Get sequence state for a contact
   *
   * @param contactId - Contact ID
   * @param campaignId - Campaign ID
   * @param sequenceTag - Sequence tag
   * @returns Sequence state or null
   */
  async getSequenceState(
    contactId: number,
    campaignId: number,
    sequenceTag: string
  ): Promise<SequenceState | null> {
    const result = await this.db.query(
      `SELECT * FROM email_sequence_state
       WHERE contact_id = $1
         AND campaign_id = $2
         AND sequence_tag = $3`,
      [contactId, campaignId, sequenceTag]
    );

    return result.rows[0] || null;
  }

  /**
   * Get all active sequences for a campaign
   *
   * @param campaignId - Campaign ID
   * @returns Array of active sequence states
   */
  async getActiveSequences(campaignId: number): Promise<SequenceState[]> {
    const result = await this.db.query(
      `SELECT * FROM email_sequence_state
       WHERE campaign_id = $1 AND status = 'active'
       ORDER BY updated_at DESC`,
      [campaignId]
    );

    return result.rows;
  }

  /**
   * Get sequence statistics for a campaign
   *
   * @param campaignId - Campaign ID
   * @returns Statistics object
   */
  async getSequenceStats(campaignId: number): Promise<{
    total: number;
    active: number;
    paused: number;
    completed: number;
    failed: number;
  }> {
    const result = await this.db.query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'active') as active,
         COUNT(*) FILTER (WHERE status = 'paused') as paused,
         COUNT(*) FILTER (WHERE status = 'completed') as completed,
         COUNT(*) FILTER (WHERE status = 'failed') as failed
       FROM email_sequence_state
       WHERE campaign_id = $1`,
      [campaignId]
    );

    return result.rows[0];
  }

  /**
   * Reset a failed sequence to retry
   *
   * @param contactId - Contact ID
   * @param campaignId - Campaign ID
   * @param sequenceTag - Sequence tag
   * @param restartFromPosition - Position to restart from (default: 1)
   */
  async resetFailedSequence(
    contactId: number,
    campaignId: number,
    sequenceTag: string,
    restartFromPosition: number = 1
  ): Promise<SequenceState> {
    const result = await this.db.query(
      `UPDATE email_sequence_state
       SET
         status = 'active',
         current_position = $4 - 1,
         current_queue_id = NULL,
         last_failed_position = NULL,
         last_failed_at = NULL,
         failure_reason = NULL,
         updated_at = NOW()
       WHERE contact_id = $1
         AND campaign_id = $2
         AND sequence_tag = $3
       RETURNING *`,
      [contactId, campaignId, sequenceTag, restartFromPosition]
    );

    if (!result.rows[0]) {
      throw new Error('Sequence state not found');
    }

    return result.rows[0];
  }
}

/**
 * Create a singleton instance of SequenceManager
 */
let defaultManager: SequenceManager | null = null;

export function createSequenceManager(
  db: DatabasePool,
  emailQueue: EmailQueue,
  config?: Partial<SequenceConfig>
): SequenceManager {
  return new SequenceManager(db, emailQueue, config);
}

export function getDefaultManager(): SequenceManager | null {
  return defaultManager;
}

export function setDefaultManager(manager: SequenceManager): void {
  defaultManager = manager;
}
