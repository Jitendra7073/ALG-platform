/**
 * GET /api/campaigns/[id] - Get a single campaign
 * PUT /api/campaigns/[id] - Update a campaign
 * DELETE /api/campaigns/[id] - Delete a campaign
 */

import { NextRequest } from 'next/server';
import {
  dbGet,
  dbRun,
  dbAll,
} from '../../../db';
import {
  errorResponse,
  getIdParam,
  notFound,
  successResponse,
  withErrorHandler,
} from '../../../validation';
import { EmailCampaign } from '../../../types';

// ============================================================================
// GET /api/campaigns/[id] - Get single campaign
// ============================================================================

export const GET = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  const campaign = await dbGet<EmailCampaign>(
    `
    SELECT ec.*,
           et.name as template_name,
           et.subject as template_subject,
           et.html_content as template_html,
           et.text_content as template_text
    FROM email_campaigns ec
    LEFT JOIN email_templates et ON ec.template_id = et.id
    WHERE ec.id = $1
    `,
    [id],
  );

  if (!campaign) {
    return notFound('Campaign not found');
  }

  // Get queue items for this campaign
  const queueItems = await dbAll<{
    id: number;
    recipient_email: string;
    status: string;
    sent_at: string | null;
  }>(
    `
    SELECT id, recipient_email, status, sent_at
    FROM email_queue
    WHERE campaign_id = $1
    ORDER BY created_at DESC
    LIMIT 100
    `,
    [id],
  );

  return successResponse({
    ...campaign,
    recent_queue_items: queueItems,
  });
});

// ============================================================================
// PUT /api/campaigns/[id] - Update campaign
// ============================================================================

export const PUT = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);
  const body = await request.json();

  // Check if campaign exists
  const existing = await dbGet<{ status: string }>(
    'SELECT status FROM email_campaigns WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Campaign not found');
  }

  // Don't allow modifying running campaigns
  if (existing.status === 'running') {
    return errorResponse(400, 'Cannot modify running campaign');
  }

  // Build update query dynamically
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (body.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    params.push(body.name);
  }

  if (body.template_id !== undefined) {
    updates.push(`template_id = $${paramIndex++}`);
    params.push(body.template_id);
  }

  if (body.target_type !== undefined) {
    updates.push(`target_type = $${paramIndex++}`);
    params.push(body.target_type);
  }

  if (body.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    params.push(body.status);
  }

  if (updates.length === 0) {
    return errorResponse(400, 'No valid fields to update');
  }

  params.push(id);

  await dbRun(
    `UPDATE email_campaigns SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    params,
  );

  const updated = await dbGet<EmailCampaign>(
    'SELECT * FROM email_campaigns WHERE id = $1',
    [id],
  );

  return successResponse(updated, 'Campaign updated successfully');
});

// ============================================================================
// DELETE /api/campaigns/[id] - Delete campaign
// ============================================================================

export const DELETE = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  // Check if campaign exists
  const existing = await dbGet<{ status: string }>(
    'SELECT status FROM email_campaigns WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Campaign not found');
  }

  // Don't delete running campaigns
  if (existing.status === 'running') {
    return errorResponse(400, 'Cannot delete running campaign. Pause it first.');
  }

  // Delete queue items for this campaign
  await dbRun('DELETE FROM email_queue WHERE campaign_id = $1', [id]);

  // Delete the campaign
  await dbRun('DELETE FROM email_campaigns WHERE id = $1', [id]);

  return successResponse({ id }, 'Campaign deleted successfully');
});
