/**
 * GET /api/queue/[id] - Get a single queue item
 * PUT /api/queue/[id] - Update a queue item
 * DELETE /api/queue/[id] - Delete/cancel a queue item
 */

import { NextRequest } from 'next/server';
import {
  dbGet,
  dbRun,
} from '../../db';
import {
  errorResponse,
  getIdParam,
  notFound,
  successResponse,
  withErrorHandler,
} from '../../validation';
import { EmailQueueItem } from '../../types';

// ============================================================================
// GET /api/queue/[id] - Get single queue item
// ============================================================================

export const GET = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  const item = await dbGet<EmailQueueItem>(
    `
    SELECT eq.*,
           s.country as site_country,
           s.url as site_url,
           es.name as sender_name,
           es.email as sender_email
    FROM email_queue eq
    LEFT JOIN contacts c ON eq.contact_id = c.id
    LEFT JOIN sites s ON c.site_id = s.id
    LEFT JOIN email_senders es ON eq.sender_id = es.id
    WHERE eq.id = $1
    `,
    [id],
  );

  if (!item) {
    return notFound('Queue item not found');
  }

  return successResponse(item);
});

// ============================================================================
// PUT /api/queue/[id] - Update queue item
// ============================================================================

export const PUT = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);
  const body = await request.json();

  // Check if item exists
  const existing = await dbGet<{ status: string }>(
    'SELECT status FROM email_queue WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Queue item not found');
  }

  // Don't allow modifying sent emails
  if (existing.status === 'sent') {
    return errorResponse(400, 'Cannot modify already sent email');
  }

  // Build update query dynamically
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (body.scheduled_at !== undefined) {
    updates.push(`scheduled_at = $${paramIndex++}`);
    params.push(body.scheduled_at);
  }

  if (body.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    params.push(body.status);
  }

  if (body.priority !== undefined) {
    // Priority could be implemented by adjusting created_at
    updates.push(`created_at = $${paramIndex++}`);
    params.push(body.priority === 'high' ? new Date(Date.now() - 86400000).toISOString() : new Date().toISOString());
  }

  if (updates.length === 0) {
    return errorResponse(400, 'No valid fields to update');
  }

  params.push(id);

  await dbRun(
    `UPDATE email_queue SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    params,
  );

  return successResponse({ id }, 'Queue item updated');
});

// ============================================================================
// DELETE /api/queue/[id] - Delete/cancel queue item
// ============================================================================

export const DELETE = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  // Check if item exists
  const existing = await dbGet<{ status: string }>(
    'SELECT status FROM email_queue WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Queue item not found');
  }

  // If already sent, just mark as cancelled instead of deleting
  if (existing.status === 'sent') {
    return errorResponse(400, 'Cannot delete already sent email');
  }

  // Delete the item
  await dbRun('DELETE FROM email_queue WHERE id = $1', [id]);

  return successResponse({ id }, 'Queue item deleted');
});
