/**
 * Database Query Functions
 * All SQL queries organized by table with prepared statements
 */

import type {
  EmailQueue,
  EmailSender,
  EmailTemplate,
  EmailCampaign,
  EmailSequenceState,
  EmailSendLog,
  EmailSetting,
  CountryTimezone,
  QueueItemForProcessing,
  SenderAvailability,
  CreateEmailQueue,
  CreateEmailSequenceState,
  UpdateEmailQueue,
  UpdateEmailCampaign,
} from './schema';
import type { DbClient, Transaction } from './client';

// =====================================================
// QUEUE OPERATIONS
// =====================================================

export class QueueQueries {
  constructor(private db: DbClient) {}

  /**
   * Create a new queue item
   */
  async create(input: CreateEmailQueue): Promise<number> {
    const sql = `
      INSERT INTO email_queue (
        campaign_id, sender_id, contact_id,
        recipient_email, recipient_name,
        template_id, subject, html_content, text_content,
        sequence_tag, sequence_position, depends_on_queue_id,
        priority, scheduled_at,
        max_attempts, idempotency_key, country_code
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )
      RETURNING id
    `;
    const result = await this.db.query<{ id: number }>(sql, [
      input.campaign_id,
      input.sender_id,
      input.contact_id,
      input.recipient_email,
      input.recipient_name,
      input.template_id,
      input.subject,
      input.html_content,
      input.text_content,
      input.sequence_tag,
      input.sequence_position,
      input.depends_on_queue_id,
      input.priority,
      input.scheduled_at,
      input.max_attempts,
      input.idempotency_key,
      input.country_code,
    ]);
    return result.rows[0].id;
  }

  /**
   * Get a queue item by ID with lock (FOR UPDATE)
   * Use within a transaction
   */
  async getByIdForUpdate(trx: Transaction, id: number): Promise<QueueItemForProcessing | null> {
    const sql = `
      SELECT eq.*,
             s.country as site_country,
             s.url as site_url,
             c.type as contact_type,
             t.tags as template_tags
      FROM email_queue eq
      LEFT JOIN contacts c ON eq.contact_id = c.id
      LEFT JOIN sites s ON c.site_id = s.id
      LEFT JOIN email_templates t ON eq.template_id = t.id
      WHERE eq.id = $1
      FOR UPDATE SKIP LOCKED
    `;
    const result = await trx.query<QueueItemForProcessing>(sql, [id]);
    return result.rows[0] || null;
  }

  /**
   * Get a queue item by ID (no lock)
   */
  async getById(id: number): Promise<QueueItemForProcessing | null> {
    const sql = `
      SELECT eq.*,
             s.country as site_country,
             s.url as site_url,
             c.type as contact_type,
             t.tags as template_tags
      FROM email_queue eq
      LEFT JOIN contacts c ON eq.contact_id = c.id
      LEFT JOIN sites s ON c.site_id = s.id
      LEFT JOIN email_templates t ON eq.template_id = t.id
      WHERE eq.id = $1
    `;
    return await this.db.one<QueueItemForProcessing>(sql, [id]);
  }

  /**
   * Get pending queue items for countries currently in business hours
   */
  async getPendingForBusinessHours(countries: string[], limit = 10): Promise<QueueItemForProcessing[]> {
    if (countries.length === 0) return [];

    const placeholders = countries.map((_, i) => `$${i + 2}`).join(',');
    const sql = `
      SELECT eq.*,
             s.country as site_country,
             s.url as site_url,
             c.type as contact_type
      FROM email_queue eq
      LEFT JOIN contacts c ON eq.contact_id = c.id
      LEFT JOIN sites s ON c.site_id = s.id
      WHERE eq.status IN ('pending', 'scheduled')
        AND (eq.scheduled_at IS NULL OR eq.scheduled_at <= NOW())
        AND s.country IN (${placeholders})
      ORDER BY eq.priority ASC, eq.created_at ASC
      LIMIT $1
    `;
    return await this.db.many<QueueItemForProcessing>(sql, [limit, ...countries]);
  }

  /**
   * Get pending queue items (any country)
   */
  async getPending(limit = 10): Promise<QueueItemForProcessing[]> {
    const sql = `
      SELECT eq.*,
             s.country as site_country,
             s.url as site_url,
             c.type as contact_type
      FROM email_queue eq
      LEFT JOIN contacts c ON eq.contact_id = c.id
      LEFT JOIN sites s ON c.site_id = s.id
      WHERE eq.status IN ('pending', 'scheduled')
        AND (eq.scheduled_at IS NULL OR eq.scheduled_at <= NOW())
      ORDER BY eq.priority ASC, eq.created_at ASC
      LIMIT $1
    `;
    return await this.db.many<QueueItemForProcessing>(sql, [limit]);
  }

  /**
   * Acquire queue items for processing (updates status to 'acquired')
   * Uses SKIP LOCKED to avoid contention
   */
  async acquireItems(limit = 5): Promise<QueueItemForProcessing[]> {
    const sql = `
      UPDATE email_queue
      SET status = 'acquired',
          started_at = NOW(),
          attempts = attempts + 1
      WHERE id IN (
        SELECT eq.id
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE eq.status IN ('pending', 'scheduled')
          AND (eq.scheduled_at IS NULL OR eq.scheduled_at <= NOW())
          AND eq.attempts < eq.max_attempts
        ORDER BY eq.priority ASC, eq.created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;
    return await this.db.many<QueueItemForProcessing>(sql, [limit]);
  }

  /**
   * Update queue item status
   */
  async updateStatus(id: number, status: EmailQueue['status'], additionalFields?: Partial<UpdateEmailQueue>): Promise<void> {
    const updates: string[] = ['status = $2'];
    const params: unknown[] = [id, status];
    let paramIndex = 3;

    if (additionalFields) {
      if (additionalFields.sender_id !== undefined) {
        updates.push(`sender_id = $${paramIndex++}`);
        params.push(additionalFields.sender_id);
      }
      if (additionalFields.completed_at !== undefined) {
        updates.push(`completed_at = $${paramIndex++}`);
        params.push(additionalFields.completed_at);
      }
      if (additionalFields.last_error !== undefined) {
        updates.push(`last_error = $${paramIndex++}`);
        params.push(additionalFields.last_error);
      }
      if (additionalFields.last_error_at !== undefined) {
        updates.push(`last_error_at = $${paramIndex++}`);
        params.push(additionalFields.last_error_at);
      }
      if (additionalFields.scheduled_at !== undefined) {
        updates.push(`scheduled_at = $${paramIndex++}`);
        params.push(additionalFields.scheduled_at);
      }
      if (additionalFields.processing_token !== undefined) {
        updates.push(`processing_token = $${paramIndex++}`);
        params.push(additionalFields.processing_token);
      }
    }

    const sql = `
      UPDATE email_queue
      SET ${updates.join(', ')}
      WHERE id = $1
    `;
    await this.db.query(sql, params);
  }

  /**
   * Update queue item within a transaction
   */
  async updateInTransaction(trx: Transaction, id: number, updates: Partial<UpdateEmailQueue>): Promise<void> {
    const entries = Object.entries(updates).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return;

    const setClause = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = entries.map(([, v]) => v);

    const sql = `
      UPDATE email_queue
      SET ${setClause}
      WHERE id = $1
    `;
    await trx.query(sql, [id, ...values]);
  }

  /**
   * Mark queue item as sent
   */
  async markSent(id: number, senderId: number, messageId?: string): Promise<void> {
    const sql = `
      UPDATE email_queue
      SET status = 'sent',
          sender_id = $2,
          completed_at = NOW(),
          processing_token = NULL
      WHERE id = $1
    `;
    await this.db.query(sql, [id, senderId]);
  }

  /**
   * Mark queue item as failed
   */
  async markFailed(id: number, error: string, permanent = false): Promise<void> {
    const status = permanent ? 'failed_permanent' : 'failed';
    const sql = `
      UPDATE email_queue
      SET status = $2,
          last_error = $3,
          last_error_at = NOW(),
          processing_token = NULL
      WHERE id = $1
    `;
    await this.db.query(sql, [id, status, error]);
  }

  /**
   * Reschedule queue item
   */
  async reschedule(id: number, scheduledAt: Date, status: EmailQueue['status'] = 'scheduled'): Promise<void> {
    const sql = `
      UPDATE email_queue
      SET status = $2,
          scheduled_at = $3,
          processing_token = NULL
      WHERE id = $1
    `;
    await this.db.query(sql, [id, status, scheduledAt]);
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    scheduled: number;
    acquired: number;
    sent: number;
    failed: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status = 'acquired') as acquired,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status IN ('failed', 'failed_permanent')) as failed
      FROM email_queue
    `;
    const result = await this.db.one<{
      pending: string;
      scheduled: string;
      acquired: string;
      sent: string;
      failed: string;
    }>(sql);

    return {
      total: 0, // Calculate from sum
      pending: parseInt(result.pending) || 0,
      scheduled: parseInt(result.scheduled) || 0,
      acquired: parseInt(result.acquired) || 0,
      sent: parseInt(result.sent) || 0,
      failed: parseInt(result.failed) || 0,
    };
  }

  /**
   * Get queue breakdown by country
   */
  async getByCountry(): Promise<Array<{ country: string; count: number }>> {
    const sql = `
      SELECT COALESCE(s.country, 'unknown') as country, COUNT(*) as count
      FROM email_queue eq
      LEFT JOIN contacts c ON eq.contact_id = c.id
      LEFT JOIN sites s ON c.site_id = s.id
      WHERE eq.status IN ('pending', 'scheduled')
      GROUP BY COALESCE(s.country, 'unknown')
      ORDER BY count DESC
    `;
    return await this.db.many<{ country: string; count: number }>(sql);
  }

  /**
   * Delete queue items (for cleanup/testing)
   */
  async delete(id: number): Promise<boolean> {
    const sql = 'DELETE FROM email_queue WHERE id = $1';
    const result = await this.db.query(sql, [id]);
    return (result.rowCount || 0) > 0;
  }

  /**
   * Get queue items by campaign
   */
  async getByCampaign(campaignId: number, status?: EmailQueue['status']): Promise<EmailQueue[]> {
    let sql = `
      SELECT eq.* FROM email_queue eq
      WHERE eq.campaign_id = $1
    `;
    const params: unknown[] = [campaignId];

    if (status) {
      sql += ' AND eq.status = $2';
      params.push(status);
    }

    sql += ' ORDER BY eq.created_at DESC';

    return await this.db.many<EmailQueue>(sql, params);
  }

  /**
   * Get queue items by contact
   */
  async getByContact(contactId: number): Promise<EmailQueue[]> {
    const sql = `
      SELECT eq.* FROM email_queue eq
      WHERE eq.contact_id = $1
      ORDER BY eq.sequence_position ASC
    `;
    return await this.db.many<EmailQueue>(sql, [contactId]);
  }

  /**
   * Check if email was already sent (idempotency check)
   */
  async checkAlreadySent(contactId: number, sequenceTag: string, sequencePosition: number): Promise<EmailQueue | null> {
    const sql = `
      SELECT * FROM email_queue
      WHERE contact_id = $1
        AND sequence_tag = $2
        AND sequence_position = $3
        AND status = 'sent'
      LIMIT 1
    `;
    return await this.db.one<EmailQueue>(sql, [contactId, sequenceTag, sequencePosition]);
  }
}

// =====================================================
// CONTACT OPERATIONS
// =====================================================

export class ContactQueries {
  constructor(private db: DbClient) {}

  /**
   * Get contact by ID
   */
  async getById(id: number): Promise<{
    id: number;
    site_id: number;
    type: string;
    value: string;
    is_bouncing: boolean;
    bounce_reason: string | null;
    created_at: string;
  } | null> {
    const sql = 'SELECT * FROM contacts WHERE id = $1';
    return await this.db.one(sql, [id]);
  }

  /**
   * Get contacts by site
   */
  async getBySite(siteId: number, type?: string): Promise<Array<{
    id: number;
    site_id: number;
    type: string;
    value: string;
    is_bouncing: boolean;
  }>> {
    let sql = 'SELECT id, site_id, type, value, is_bouncing FROM contacts WHERE site_id = $1';
    const params: unknown[] = [siteId];

    if (type) {
      sql += ' AND type = $2';
      params.push(type);
    }

    return await this.db.many(sql, params);
  }

  /**
   * Get email contacts for multiple sites
   */
  async getEmailsForSites(siteIds: number[]): Promise<Array<{
    id: number;
    site_id: number;
    value: string;
    is_bouncing: boolean;
  }>> {
    if (siteIds.length === 0) return [];

    const placeholders = siteIds.map((_, i) => `$${i + 1}`).join(',');
    const sql = `
      SELECT id, site_id, value, is_bouncing
      FROM contacts
      WHERE type = 'email' AND site_id IN (${placeholders})
        AND is_bouncing = 0
    `;
    return await this.db.many(sql, siteIds);
  }

  /**
   * Mark contact as bouncing
   */
  async markBouncing(contactId: number, reason: string): Promise<void> {
    const sql = `
      UPDATE contacts
      SET is_bouncing = 1,
          bounce_reason = $2
      WHERE id = $1
    `;
    await this.db.query(sql, [contactId, reason]);
  }

  /**
   * Get contact count by site
   */
  async getCountBySite(siteId: number): Promise<{ email: number; phone: number; linkedin: number }> {
    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE type = 'email') as email,
        COUNT(*) FILTER (WHERE type = 'phone') as phone,
        COUNT(*) FILTER (WHERE type = 'linkedin') as linkedin
      FROM contacts
      WHERE site_id = $1
    `;
    const result = await this.db.one<{ email: string; phone: string; linkedin: string }>(sql, [siteId]);
    return {
      email: parseInt(result.email) || 0,
      phone: parseInt(result.phone) || 0,
      linkedin: parseInt(result.linkedin) || 0,
    };
  }
}

// =====================================================
// TEMPLATE OPERATIONS
// =====================================================

export class TemplateQueries {
  constructor(private db: DbClient) {}

  /**
   * Get all active templates
   */
  async getAll(): Promise<EmailTemplate[]> {
    const sql = `
      SELECT * FROM email_templates
      WHERE is_active = true
      ORDER BY category, sequence_number, name
    `;
    return await this.db.many<EmailTemplate>(sql);
  }

  /**
   * Get template by ID
   */
  async getById(id: number): Promise<EmailTemplate | null> {
    const sql = 'SELECT * FROM email_templates WHERE id = $1';
    return await this.db.one<EmailTemplate>(sql, [id]);
  }

  /**
   * Get templates by tag
   */
  async getByTag(tag: string): Promise<EmailTemplate[]> {
    const sql = `
      SELECT * FROM email_templates
      WHERE is_active = true
        AND $1 = ANY(tags)
      ORDER BY sequence_number ASC
    `;
    return await this.db.many<EmailTemplate>(sql, [tag]);
  }

  /**
   * Get templates by category
   */
  async getByCategory(category: string): Promise<EmailTemplate[]> {
    const sql = `
      SELECT * FROM email_templates
      WHERE is_active = true
        AND category = $1
      ORDER BY sequence_number ASC, name ASC
    `;
    return await this.db.many<EmailTemplate>(sql, [category]);
  }

  /**
   * Get template sequence for a tag
   */
  async getSequenceForTag(tag: string): Promise<EmailTemplate[]> {
    const sql = `
      SELECT * FROM email_templates
      WHERE is_active = true
        AND $1 = ANY(tags)
      ORDER BY sequence_number ASC
    `;
    return await this.db.many<EmailTemplate>(sql, [tag]);
  }

  /**
   * Create a new template
   */
  async create(input: {
    name: string;
    subject: string;
    html_content: string;
    text_content?: string;
    category?: string;
    tags?: string[];
    sequence_number?: number;
  }): Promise<number> {
    const sql = `
      INSERT INTO email_templates (
        name, subject, html_content, text_content,
        category, tags, sequence_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;
    const result = await this.db.query<{ id: number }>(sql, [
      input.name,
      input.subject,
      input.html_content,
      input.text_content || null,
      input.category || 'general',
      input.tags || [],
      input.sequence_number || 0,
    ]);
    return result.rows[0].id;
  }

  /**
   * Update template
   */
  async update(id: number, updates: Partial<Omit<EmailTemplate, 'id' | 'created_at' | 'version'>>): Promise<void> {
    const entries = Object.entries(updates).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return;

    const setClause = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = entries.map(([, v]) => v);

    const sql = `
      UPDATE email_templates
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id, ...values]);
  }

  /**
   * Delete template (soft delete by setting is_active = false)
   */
  async delete(id: number): Promise<void> {
    const sql = 'UPDATE email_templates SET is_active = false WHERE id = $1';
    await this.db.query(sql, [id]);
  }

  /**
   * Get all tags
   */
  async getAllTags(): Promise<string[]> {
    const sql = `
      SELECT DISTINCT unnest(tags) as tag
      FROM email_templates
      WHERE is_active = true
      ORDER BY tag
    `;
    const results = await this.db.many<{ tag: string }>(sql);
    return results.map((r) => r.tag);
  }
}

// =====================================================
// SENDER OPERATIONS
// =====================================================

export class SenderQueries {
  constructor(private db: DbClient) {}

  /**
   * Get all active senders
   */
  async getActive(): Promise<EmailSender[]> {
    const sql = `
      SELECT * FROM email_senders
      WHERE is_active = true
      ORDER BY created_at ASC
    `;
    return await this.db.many<EmailSender>(sql);
  }

  /**
   * Get sender by ID
   */
  async getById(id: number): Promise<EmailSender | null> {
    const sql = 'SELECT * FROM email_senders WHERE id = $1';
    return await this.db.one<EmailSender>(sql, [id]);
  }

  /**
   * Get sender availability for all active senders
   */
  async getAvailability(): Promise<SenderAvailability[]> {
    const sql = `
      SELECT
        id, name, email,
        sent_today, sent_hour,
        daily_limit, hourly_limit,
        (sent_today < daily_limit AND sent_hour < hourly_limit) as available
      FROM email_senders
      WHERE is_active = true
      ORDER BY created_at ASC
    `;
    return await this.db.many<any>(sql);
  }

  /**
   * Get next available sender (round-robin with daily/hourly limits)
   */
  async getNextAvailable(lastSenderId?: number): Promise<EmailSender | null> {
    const sql = `
      SELECT * FROM email_senders
      WHERE is_active = true
        AND sent_today < daily_limit
        AND sent_hour < hourly_limit
        AND ($1::int IS NULL OR id > $1 OR id <= (
          SELECT MIN(id) FROM email_senders WHERE is_active = true
        ))
      ORDER BY
        CASE WHEN $1::int IS NULL OR id > $1 THEN 0 ELSE 1 END,
        id ASC
      LIMIT 1
    `;
    return await this.db.one<EmailSender>(sql, [lastSenderId || null]);
  }

  /**
   * Increment sent counters for a sender
   */
  async incrementSent(id: number): Promise<void> {
    const sql = `
      UPDATE email_senders
      SET sent_today = sent_today + 1,
          sent_hour = sent_hour + 1,
          updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id]);
  }

  /**
   * Reset daily counters (should be called daily)
   */
  async resetDailyCounters(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const sql = `
      UPDATE email_senders
      SET sent_today = 0,
          last_reset_date = $1::date,
          updated_at = NOW()
      WHERE last_reset_date IS NULL OR last_reset_date < $1::date
    `;
    await this.db.query(sql, [today]);
  }

  /**
   * Reset hourly counters (should be called hourly)
   */
  async resetHourlyCounters(): Promise<void> {
    const sql = `
      UPDATE email_senders
      SET sent_hour = 0,
          last_reset_hour = NOW(),
          updated_at = NOW()
      WHERE EXTRACT(HOUR FROM NOW()) > EXTRACT(HOUR FROM COALESCE(last_reset_hour, NOW() - INTERVAL '1 hour'))
    `;
    await this.db.query(sql);
  }

  /**
   * Create a new sender
   */
  async create(input: {
    name: string;
    email: string;
    password_encrypted: string;
    service?: string;
    smtp_host?: string;
    smtp_port?: number;
    smtp_user?: string;
    daily_limit?: number;
    hourly_limit?: number;
  }): Promise<number> {
    const sql = `
      INSERT INTO email_senders (
        name, email, password_encrypted, service,
        smtp_host, smtp_port, smtp_user,
        daily_limit, hourly_limit
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;
    const result = await this.db.query<{ id: number }>(sql, [
      input.name,
      input.email,
      input.password_encrypted,
      input.service || 'gmail',
      input.smtp_host || null,
      input.smtp_port || null,
      input.smtp_user || null,
      input.daily_limit || 500,
      input.hourly_limit || 50,
    ]);
    return result.rows[0].id;
  }

  /**
   * Update sender
   */
  async update(id: number, updates: Partial<Omit<EmailSender, 'id' | 'created_at'>>): Promise<void> {
    const entries = Object.entries(updates).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return;

    const setClause = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = entries.map(([, v]) => v);

    const sql = `
      UPDATE email_senders
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id, ...values]);
  }

  /**
   * Activate/deactivate sender
   */
  async setActive(id: number, isActive: boolean): Promise<void> {
    const sql = 'UPDATE email_senders SET is_active = $2, updated_at = NOW() WHERE id = $1';
    await this.db.query(sql, [id, isActive]);
  }

  /**
   * Delete sender
   */
  async delete(id: number): Promise<boolean> {
    const sql = 'DELETE FROM email_senders WHERE id = $1';
    const result = await this.db.query(sql, [id]);
    return (result.rowCount || 0) > 0;
  }
}

// =====================================================
// CAMPAIGN OPERATIONS
// =====================================================

export class CampaignQueries {
  constructor(private db: DbClient) {}

  /**
   * Get all campaigns
   */
  async getAll(): Promise<EmailCampaign[]> {
    const sql = `
      SELECT * FROM email_campaigns
      ORDER BY created_at DESC
    `;
    return await this.db.many<EmailCampaign>(sql);
  }

  /**
   * Get campaign by ID
   */
  async getById(id: number): Promise<EmailCampaign | null> {
    const sql = 'SELECT * FROM email_campaigns WHERE id = $1';
    return await this.db.one<EmailCampaign>(sql, [id]);
  }

  /**
   * Create a new campaign
   */
  async create(input: {
    name: string;
    description?: string;
    template_tag: string;
    template_ids: number[];
    target_criteria?: Record<string, unknown>;
    start_after?: Date;
  }): Promise<number> {
    const sql = `
      INSERT INTO email_campaigns (
        name, description, template_tag, template_ids,
        target_criteria, start_after, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'draft')
      RETURNING id
    `;
    const result = await this.db.query<{ id: number }>(sql, [
      input.name,
      input.description || null,
      input.template_tag,
      input.template_ids,
      input.target_criteria || {},
      input.start_after || null,
    ]);
    return result.rows[0].id;
  }

  /**
   * Update campaign
   */
  async update(id: number, updates: Partial<UpdateEmailCampaign>): Promise<void> {
    const entries = Object.entries(updates).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return;

    const setClause = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = entries.map(([, v]) => v);

    const sql = `
      UPDATE email_campaigns
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id, ...values]);
  }

  /**
   * Update campaign counters
   */
  async updateCounters(
    id: number,
    deltas: { sent?: number; failed?: number; queued?: number }
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [id];
    let paramIndex = 2;

    if (deltas.sent) {
      updates.push(`sent_count = sent_count + $${paramIndex++}`);
      params.push(deltas.sent);
    }
    if (deltas.failed) {
      updates.push(`failed_count = failed_count + $${paramIndex++}`);
      params.push(deltas.failed);
    }
    if (deltas.queued) {
      updates.push(`queued_count = queued_count + $${paramIndex++}`);
      params.push(deltas.queued);
    }

    if (updates.length === 0) return;

    const sql = `
      UPDATE email_campaigns
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, params);
  }

  /**
   * Set campaign status
   */
  async setStatus(id: number, status: EmailCampaign['status']): Promise<void> {
    const sql = `
      UPDATE email_campaigns
      SET status = $2, updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id, status]);
  }

  /**
   * Delete campaign
   */
  async delete(id: number): Promise<boolean> {
    const sql = 'DELETE FROM email_campaigns WHERE id = $1';
    const result = await this.db.query(sql, [id]);
    return (result.rowCount || 0) > 0;
  }

  /**
   * Get campaign statistics
   */
  async getStats(id: number): Promise<{
    total_recipients: number;
    queued_count: number;
    sent_count: number;
    failed_count: number;
    queue_status: Array<{ status: string; count: number }>;
  }> {
    const sql = `
      SELECT
        total_recipients, queued_count, sent_count, failed_count
      FROM email_campaigns
      WHERE id = $1
    `;
    const campaign = await this.db.one<{
      total_recipients: number;
      queued_count: number;
      sent_count: number;
      failed_count: number;
    }>(sql, [id]);

    const queueSql = `
      SELECT status, COUNT(*) as count
      FROM email_queue
      WHERE campaign_id = $1
      GROUP BY status
    `;
    const queueStatus = await this.db.many<{ status: string; count: number }>(queueSql, [id]);

    return {
      ...campaign,
      queue_status: queueStatus,
    };
  }
}

// =====================================================
// SEQUENCE STATE OPERATIONS
// =====================================================

export class SequenceStateQueries {
  constructor(private db: DbClient) {}

  /**
   * Get sequence state for a contact/campaign/tag
   */
  async get(contactId: number, campaignId: number, sequenceTag: string): Promise<EmailSequenceState | null> {
    const sql = `
      SELECT * FROM email_sequence_state
      WHERE contact_id = $1 AND campaign_id = $2 AND sequence_tag = $3
    `;
    return await this.db.one<EmailSequenceState>(sql, [contactId, campaignId, sequenceTag]);
  }

  /**
   * Create or update sequence state
   */
  async upsert(input: CreateEmailSequenceState & { id?: number }): Promise<number> {
    if (input.id) {
      const sql = `
        UPDATE email_sequence_state
        SET current_position = $2,
            max_position = $3,
            status = $4,
            current_queue_id = $5,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `;
      const result = await this.db.query<{ id: number }>(sql, [
        input.id,
        input.current_position,
        input.max_position,
        input.status,
        input.current_queue_id,
      ]);
      return result.rows[0].id;
    } else {
      const sql = `
        INSERT INTO email_sequence_state (
          contact_id, campaign_id, sequence_tag,
          current_position, max_position, status,
          current_queue_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (contact_id, campaign_id, sequence_tag)
        DO UPDATE SET
          current_position = EXCLUDED.current_position,
          max_position = EXCLUDED.max_position,
          status = EXCLUDED.status,
          current_queue_id = EXCLUDED.current_queue_id,
          updated_at = NOW()
        RETURNING id
      `;
      const result = await this.db.query<{ id: number }>(sql, [
        input.contact_id,
        input.campaign_id,
        input.sequence_tag,
        input.current_position,
        input.max_position,
        input.status,
        input.current_queue_id,
      ]);
      return result.rows[0].id;
    }
  }

  /**
   * Advance sequence position
   */
  async advancePosition(
    id: number,
    newPosition: number,
    queueId: number | null
  ): Promise<void> {
    const sql = `
      UPDATE email_sequence_state
      SET current_position = $2,
          current_queue_id = $3,
          updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id, newPosition, queueId]);
  }

  /**
   * Mark sequence as failed
   */
  async markFailed(
    id: number,
    failedPosition: number,
    reason: string
  ): Promise<void> {
    const sql = `
      UPDATE email_sequence_state
      SET status = 'failed',
          last_failed_position = $2,
          last_failed_at = NOW(),
          failure_reason = $3,
          updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id, failedPosition, reason]);
  }

  /**
   * Mark sequence as completed
   */
  async markCompleted(id: number): Promise<void> {
    const sql = `
      UPDATE email_sequence_state
      SET status = 'completed',
          updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id]);
  }

  /**
   * Pause sequence
   */
  async pause(id: number): Promise<void> {
    const sql = `
      UPDATE email_sequence_state
      SET status = 'paused',
          updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id]);
  }

  /**
   * Resume sequence
   */
  async resume(id: number): Promise<void> {
    const sql = `
      UPDATE email_sequence_state
      SET status = 'active',
          updated_at = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id]);
  }

  /**
   * Get all active sequences for a campaign
   */
  async getActiveByCampaign(campaignId: number): Promise<EmailSequenceState[]> {
    const sql = `
      SELECT * FROM email_sequence_state
      WHERE campaign_id = $1 AND status = 'active'
      ORDER BY updated_at DESC
    `;
    return await this.db.many<EmailSequenceState>(sql, [campaignId]);
  }
}

// =====================================================
// SEND LOG OPERATIONS
// =====================================================

export class SendLogQueries {
  constructor(private db: DbClient) {}

  /**
   * Log an email send
   */
  async log(input: {
    queue_id: number;
    contact_id: number;
    template_id?: number;
    sender_id?: number;
    campaign_id?: number;
    to_email: string;
    from_email: string;
    subject: string;
    provider: string;
    provider_message_id?: string;
    status?: 'sent' | 'bounced' | 'opened' | 'clicked' | 'complained';
    error_message?: string;
  }): Promise<number> {
    const sql = `
      INSERT INTO email_send_log (
        queue_id, contact_id, template_id, sender_id, campaign_id,
        to_email, from_email, subject,
        provider, provider_message_id,
        status, error_message, sent_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (queue_id) DO NOTHING
      RETURNING id
    `;
    const result = await this.db.query<{ id: number }>(sql, [
      input.queue_id,
      input.contact_id,
      input.template_id || null,
      input.sender_id || null,
      input.campaign_id || null,
      input.to_email,
      input.from_email,
      input.subject,
      input.provider,
      input.provider_message_id || null,
      input.status || 'sent',
      input.error_message || null,
    ]);
    return result.rows[0]?.id || 0;
  }

  /**
   * Update send log status (for bounce/open/click tracking)
   */
  async updateStatus(id: number, status: 'bounced' | 'opened' | 'clicked' | 'complained'): Promise<void> {
    const timestampField = {
      bounced: 'delivered_at',
      opened: 'opened_at',
      clicked: 'clicked_at',
      complained: 'delivered_at',
    }[status];

    const sql = `
      UPDATE email_send_log
      SET status = $2, ${timestampField} = NOW()
      WHERE id = $1
    `;
    await this.db.query(sql, [id, status]);
  }

  /**
   * Get send log by queue ID
   */
  async getByQueueId(queueId: number): Promise<EmailSendLog | null> {
    const sql = 'SELECT * FROM email_send_log WHERE queue_id = $1';
    return await this.db.one<EmailSendLog>(sql, [queueId]);
  }

  /**
   * Get send log by contact
   */
  async getByContact(contactId: number, limit = 100): Promise<EmailSendLog[]> {
    const sql = `
      SELECT * FROM email_send_log
      WHERE contact_id = $1
      ORDER BY sent_at DESC
      LIMIT $2
    `;
    return await this.db.many<EmailSendLog>(sql, [contactId, limit]);
  }

  /**
   * Get send log statistics
   */
  async getStats(filters?: {
    campaign_id?: number;
    sender_id?: number;
    template_id?: number;
    from_date?: Date;
    to_date?: Date;
  }): Promise<{
    sent: number;
    bounced: number;
    opened: number;
    clicked: number;
    complained: number;
  }> {
    let sql = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'bounced') as bounced,
        COUNT(*) FILTER (WHERE status = 'opened') as opened,
        COUNT(*) FILTER (WHERE status = 'clicked') as clicked,
        COUNT(*) FILTER (WHERE status = 'complained') as complained
      FROM email_send_log
      WHERE 1=1
    `;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.campaign_id) {
      sql += ` AND campaign_id = $${paramIndex++}`;
      params.push(filters.campaign_id);
    }
    if (filters?.sender_id) {
      sql += ` AND sender_id = $${paramIndex++}`;
      params.push(filters.sender_id);
    }
    if (filters?.template_id) {
      sql += ` AND template_id = $${paramIndex++}`;
      params.push(filters.template_id);
    }
    if (filters?.from_date) {
      sql += ` AND sent_at >= $${paramIndex++}`;
      params.push(filters.from_date);
    }
    if (filters?.to_date) {
      sql += ` AND sent_at <= $${paramIndex++}`;
      params.push(filters.to_date);
    }

    const result = await this.db.one<{
      sent: string;
      bounced: string;
      opened: string;
      clicked: string;
      complained: string;
    }>(sql, params);

    return {
      sent: parseInt(result.sent) || 0,
      bounced: parseInt(result.bounced) || 0,
      opened: parseInt(result.opened) || 0,
      clicked: parseInt(result.clicked) || 0,
      complained: parseInt(result.complained) || 0,
    };
  }
}

// =====================================================
// SETTINGS OPERATIONS
// =====================================================

export class SettingsQueries {
  constructor(private db: DbClient) {}

  /**
   * Get a setting value
   */
  async get(key: string): Promise<unknown> {
    const sql = 'SELECT value FROM email_settings WHERE key = $1';
    const result = await this.db.one<{ value: unknown }>(sql, [key]);
    return result?.value;
  }

  /**
   * Get a typed setting
   */
  async getString(key: string): Promise<string | null> {
    const value = await this.get(key);
    return typeof value === 'string' ? value : null;
  }

  async getNumber(key: string): Promise<number | null> {
    const value = await this.get(key);
    return typeof value === 'number' ? value : null;
  }

  async getBoolean(key: string): Promise<boolean> {
    const value = await this.get(key);
    return Boolean(value);
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const value = await this.get(key);
    return value !== null ? (value as T) : null;
  }

  /**
   * Set a setting value
   */
  async set(key: string, value: unknown, description?: string): Promise<void> {
    const sql = `
      INSERT INTO email_settings (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          description = COALESCE(EXCLUDED.description, $3),
          updated_at = NOW()
    `;
    await this.db.query(sql, [key, value, description || null]);
  }

  /**
   * Get all settings
   */
  async getAll(): Promise<Array<{ key: string; value: unknown; description: string | null }>> {
    const sql = 'SELECT key, value, description FROM email_settings ORDER BY key';
    return await this.db.many(sql);
  }

  /**
   * Delete a setting
   */
  async delete(key: string): Promise<boolean> {
    const sql = 'DELETE FROM email_settings WHERE key = $1';
    const result = await this.db.query(sql, [key]);
    return (result.rowCount || 0) > 0;
  }

  /**
   * Seed default settings
   */
  async seedDefaults(): Promise<void> {
    const defaults = [
      { key: 'per_email_delay', value: 60, description: 'Seconds to wait between emails' },
      { key: 'cycle_cooldown_min', value: 600, description: 'Min cooldown between cycles (seconds)' },
      { key: 'cycle_cooldown_max', value: 780, description: 'Max cooldown between cycles (seconds)' },
      { key: 'followup_gap_1', value: 2, description: 'Days before follow-up 1' },
      { key: 'followup_gap_2', value: 5, description: 'Days before follow-up 2' },
      { key: 'followup_gap_3', value: 5, description: 'Days before follow-up 3' },
      { key: 'followup_gap_4', value: 5, description: 'Days before follow-up 4' },
      { key: 'worker_enabled', value: true, description: 'Enable email queue worker' },
      { key: 'worker_concurrency', value: 3, description: 'Max concurrent sends' },
      { key: 'max_retry_attempts', value: 3, description: 'Max retry attempts for failed emails' },
      { key: 'retry_backoff_base', value: 15, description: 'Base retry delay in minutes' },
    ];

    for (const setting of defaults) {
      await this.set(setting.key, setting.value, setting.description);
    }
  }
}

// =====================================================
// COUNTRY TIMEZONE OPERATIONS
// =====================================================

export class CountryTimezoneQueries {
  constructor(private db: DbClient) {}

  /**
   * Get timezone info for a country
   */
  async getByCountry(country: string): Promise<CountryTimezone | null> {
    const sql = 'SELECT * FROM country_timezones WHERE country = $1';
    return await this.db.one<CountryTimezone>(sql, [country.toLowerCase()]);
  }

  /**
   * Get all country timezones
   */
  async getAll(): Promise<CountryTimezone[]> {
    const sql = 'SELECT * FROM country_timezones ORDER BY country';
    return await this.db.many<CountryTimezone>(sql);
  }

  /**
   * Get countries currently in business hours
   */
  async getInBusinessHours(): Promise<Array<{ country: string; country_name: string; timezone: string }>> {
    const sql = `
      SELECT country, country_name, timezone
      FROM country_timezones
      WHERE $1::text = ANY(business_days)
        AND EXTRACT(DOW FROM NOW() AT TIME ZONE timezone) BETWEEN 1 AND 5
        AND EXTRACT(HOUR FROM NOW() AT TIME ZONE timezone)::int >=
            CAST(SPLIT_PART(business_hours_start, ':', 1) AS int)
        AND EXTRACT(HOUR FROM NOW() AT TIME ZONE timezone)::int <
            CAST(SPLIT_PART(business_hours_end, ':', 1) AS int)
    `;
    return await this.db.many(sql, [this.getCurrentDay()]);
  }

  private getCurrentDay(): string {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return days[new Date().getDay()];
  }

  /**
   * Upsert country timezone
   */
  async upsert(input: {
    country: string;
    country_name: string;
    timezone: string;
    business_hours_start: string;
    business_hours_end: string;
    business_days: string[];
  }): Promise<void> {
    const sql = `
      INSERT INTO country_timezones (
        country, country_name, timezone,
        business_hours_start, business_hours_end, business_days
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (country) DO UPDATE
      SET country_name = EXCLUDED.country_name,
          timezone = EXCLUDED.timezone,
          business_hours_start = EXCLUDED.business_hours_start,
          business_hours_end = EXCLUDED.business_hours_end,
          business_days = EXCLUDED.business_days,
          updated_at = NOW()
    `;
    await this.db.query(sql, [
      input.country.toLowerCase(),
      input.country_name,
      input.timezone,
      input.business_hours_start,
      input.business_hours_end,
      input.business_days,
    ]);
  }
}

// =====================================================
// FACTORY FUNCTION
// =====================================================

/**
 * Create all query classes for a database client
 */
export function createQueries(db: DbClient) {
  return {
    queue: new QueueQueries(db),
    contact: new ContactQueries(db),
    template: new TemplateQueries(db),
    sender: new SenderQueries(db),
    campaign: new CampaignQueries(db),
    sequenceState: new SequenceStateQueries(db),
    sendLog: new SendLogQueries(db),
    settings: new SettingsQueries(db),
    countryTimezone: new CountryTimezoneQueries(db),
  };
}

// Export types for use in other modules
export type Queries = ReturnType<typeof createQueries>;
