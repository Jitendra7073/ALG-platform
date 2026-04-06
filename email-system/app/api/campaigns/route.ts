/**
 * GET /api/campaigns - Get email campaigns
 * POST /api/campaigns - Create a new campaign
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
  dbGet,
  dbRun,
} from '../db';
import {
  getPaginationParams,
  getPaginationMeta,
  getQueryNumber,
  getQueryParam,
  successResponse,
  validateRequired,
  withErrorHandler,
  errorResponse,
} from '../validation';
import { EmailCampaign, CreateCampaignRequest, PaginatedResponse } from '../types';

// ============================================================================
// GET /api/campaigns - Get campaigns
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
  if (status && ['draft', 'queued', 'running', 'paused', 'completed', 'failed'].includes(status)) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  // Build WHERE clause
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await dbGet<{ count: string }>(
    `SELECT COUNT(*) as count FROM email_campaigns ${whereClause}`,
    params,
  );
  const total = countResult ? parseInt(countResult.count, 10) : 0;

  // Get paginated results
  params.push(pagination.limit!, pagination.offset!);
  const campaigns = await dbAll<EmailCampaign>(
    `
    SELECT ec.*,
           et.name as template_name,
           et.subject as template_subject
    FROM email_campaigns ec
    LEFT JOIN email_templates et ON ec.template_id = et.id
    ${whereClause}
    ORDER BY ec.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `,
    params,
  );

  return successResponse<PaginatedResponse<EmailCampaign>>({
    data: campaigns,
    pagination: getPaginationMeta(pagination, total),
  });
});

// ============================================================================
// POST /api/campaigns - Create campaign
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json() as CreateCampaignRequest;

  // Validate required fields
  const error = validateRequired(body, ['name']);
  if (error) {
    return errorResponse(400, error);
  }

  // Validate that at least one targeting option is provided
  if (!body.site_ids && !body.contact_ids && body.target_type !== 'all') {
    return errorResponse(400, 'Must provide site_ids, contact_ids, or set target_type to "all"');
  }

  // Create the campaign
  const result = await dbRun(
    `
    INSERT INTO email_campaigns (
      name, template_id, target_type, status, total_recipients
    ) VALUES ($1, $2, $3, 'draft', 0)
    RETURNING id
    `,
    [body.name, body.template_id || null, body.target_type || 'all'],
  );

  const campaignId = String(result.lastInsertRowid);

  // Calculate recipients based on targeting
  let recipientCount = 0;

  if (body.contact_ids && body.contact_ids.length > 0) {
    recipientCount = body.contact_ids.length;
  } else if (body.site_ids && body.site_ids.length > 0) {
    // Count email contacts for these sites
    const placeholders = body.site_ids.map((_, i) => `$${i + 1}`).join(',');
    const countResult = await dbGet<{ count: string }>(
      `SELECT COUNT(*) as count FROM contacts WHERE site_id IN (${placeholders}) AND type = 'email'`,
      body.site_ids,
    );
    recipientCount = countResult ? parseInt(countResult.count, 10) : 0;
  } else {
    // Count all email contacts
    const countResult = await dbGet<{ count: string }>(
      "SELECT COUNT(*) as count FROM contacts WHERE type = 'email'",
    );
    recipientCount = countResult ? parseInt(countResult.count, 10) : 0;
  }

  // Update recipient count
  await dbRun(
    'UPDATE email_campaigns SET total_recipients = $1 WHERE id = $2',
    [recipientCount, campaignId],
  );

  const campaign = await dbGet<EmailCampaign>(
    'SELECT * FROM email_campaigns WHERE id = $1',
    [campaignId],
  );

  return successResponse(campaign, 'Campaign created successfully');
});
