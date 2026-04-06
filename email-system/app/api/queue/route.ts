/**
 * GET /api/queue
 * Get email queue items with optional filtering
 *
 * POST /api/queue/add
 * Add a new email to the queue
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
  dbGet,
  dbRun,
} from '../db';
import {
  errorResponse,
  getPaginationParams,
  getPaginationMeta,
  getQueryNumber,
  getQueryParam,
  successResponse,
  withErrorHandler,
  validateEmail,
  validateRequired,
} from '../validation';
import { EmailQueueItem, QueueQueryParams, AddToQueueRequest, ApiResponse, PaginatedResponse } from '../types';

// ============================================================================
// GET /api/queue - Get queue items
// ============================================================================

export const GET = withErrorHandler(async (request: NextRequest) => {
  const url = new URL(request.url);
  const pagination = getPaginationParams(url);

  // Build query conditions
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Filter by status
  const status = getQueryParam(url, 'status');
  if (status && ['queued', 'sending', 'sent', 'failed', 'cancelled'].includes(status)) {
    conditions.push(`eq.status = $${paramIndex++}`);
    params.push(status);
  }

  // Filter by campaign
  const campaignId = getQueryNumber(url, 'campaign_id');
  if (campaignId) {
    conditions.push(`eq.campaign_id = $${paramIndex++}`);
    params.push(campaignId);
  }

  // Filter by sender
  const senderId = getQueryNumber(url, 'sender_id');
  if (senderId) {
    conditions.push(`eq.sender_id = $${paramIndex++}`);
    params.push(senderId);
  }

  // Filter by contact
  const contactId = getQueryNumber(url, 'contact_id');
  if (contactId) {
    conditions.push(`eq.contact_id = $${paramIndex++}`);
    params.push(contactId);
  }

  // Filter by tag
  const tag = getQueryParam(url, 'tag');
  if (tag) {
    conditions.push(`eq.tag = $${paramIndex++}`);
    params.push(tag);
  }

  // Build WHERE clause
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await dbGet<{ count: string }>(
    `SELECT COUNT(*) as count FROM email_queue eq ${whereClause}`,
    params,
  );
  const total = countResult ? parseInt(countResult.count, 10) : 0;

  // Get paginated results
  params.push(pagination.limit!, pagination.offset!);
  const items = await dbAll<EmailQueueItem>(
    `
    SELECT eq.*,
           s.country as site_country,
           s.url as site_url
    FROM email_queue eq
    LEFT JOIN contacts c ON eq.contact_id = c.id
    LEFT JOIN sites s ON c.site_id = s.id
    ${whereClause}
    ORDER BY eq.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `,
    params,
  );

  return successResponse<PaginatedResponse<EmailQueueItem>>({
    data: items,
    pagination: getPaginationMeta(pagination, total),
  });
});

// ============================================================================
// POST /api/queue/add - Add email to queue
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json() as AddToQueueRequest;

  // Validate required fields
  const error = validateRequired(body, ['recipient_email']);
  if (error) {
    return errorResponse(400, error);
  }

  // Validate email format
  if (!validateEmail(body.recipient_email)) {
    return errorResponse(400, 'Invalid email address');
  }

  // If contact_id is provided, get contact details
  let recipientEmail = body.recipient_email;
  let recipientName: string | null = null;
  let country_code = body.country_code || null;

  if (body.contact_id) {
    const contact = await dbGet<{ value: string; site_id: number }>(
      'SELECT value, site_id FROM contacts WHERE id = $1',
      [body.contact_id],
    );

    if (contact) {
      recipientEmail = contact.value;
    }

    // Get country from site
    const site = await dbGet<{ country: string }>(
      'SELECT country FROM sites WHERE id = (SELECT site_id FROM contacts WHERE id = $1)',
      [body.contact_id],
    );

    if (site) {
      country_code = site.country;
    }
  }

  // If template_id is provided, get template content
  let subject = body.subject || '';
  let htmlContent = body.html_content || '';
  let textContent = body.text_content || null;

  if (body.template_id) {
    const template = await dbGet<{ subject: string; html_content: string; text_content: string }>(
      'SELECT subject, html_content, text_content FROM email_templates WHERE id = $1',
      [body.template_id],
    );

    if (template) {
      subject = template.subject;
      htmlContent = template.html_content;
      textContent = template.text_content;
    }
  }

  // Validate required content
  if (!subject || !htmlContent) {
    return errorResponse(400, 'Either template_id or subject and html_content are required');
  }

  // Insert into queue with RETURNING clause to get the inserted id
  const result = await dbRun(
    `
    INSERT INTO email_queue (
      campaign_id, contact_id, recipient_email, recipient_name,
      subject, html_content, text_content, tag, sequence_position,
      country_code, scheduled_at, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'queued')
    RETURNING id
    `,
    [
      body.campaign_id || null,
      body.contact_id || null,
      recipientEmail,
      recipientName,
      subject,
      htmlContent,
      textContent,
      body.tag || null,
      body.sequence_position || null,
      country_code,
      body.scheduled_at || null,
    ],
  );

  return successResponse(
    {
      id: result.lastInsertRowid,
      recipient_email: recipientEmail,
      status: 'queued',
    },
    'Email added to queue',
  );
});
