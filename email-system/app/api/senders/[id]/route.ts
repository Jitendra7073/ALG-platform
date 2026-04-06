/**
 * GET /api/senders/[id] - Get a single sender
 * PUT /api/senders/[id] - Update a sender
 * DELETE /api/senders/[id] - Delete a sender
 */

import { NextRequest } from 'next/server';
import {
  dbGet,
  dbRun,
} from '../../../db';
import {
  errorResponse,
  getIdParam,
  notFound,
  successResponse,
  validateEmail,
  withErrorHandler,
} from '../../../validation';
import { EmailSender, UpdateSenderRequest } from '../../../types';

// ============================================================================
// GET /api/senders/[id] - Get single sender
// ============================================================================

export const GET = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  const sender = await dbGet<EmailSender>(
    `
    SELECT
      id, name, email, service, smtp_host, smtp_port, smtp_user,
      daily_limit, is_active, sent_today, last_reset_date, created_at, updated_at
    FROM email_senders
    WHERE id = $1
    `,
    [id],
  );

  if (!sender) {
    return notFound('Sender not found');
  }

  return successResponse(sender);
});

// ============================================================================
// PUT /api/senders/[id] - Update sender
// ============================================================================

export const PUT = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);
  const body = await request.json() as UpdateSenderRequest;

  // Check if sender exists
  const existing = await dbGet<EmailSender>(
    'SELECT * FROM email_senders WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Sender not found');
  }

  // Validate email if provided
  if (body.email && !validateEmail(body.email)) {
    return errorResponse(400, 'Invalid email address');
  }

  // Validate custom SMTP settings if service is being changed to custom
  if ((body.service === 'custom' || body.service === 'smtp') && (!body.smtp_host || !body.smtp_port)) {
    return errorResponse(400, 'smtp_host and smtp_port are required for custom SMTP');
  }

  // Build update query dynamically
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (body.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    params.push(body.name);
  }

  if (body.email !== undefined) {
    updates.push(`email = $${paramIndex++}`);
    params.push(body.email);
  }

  if (body.password !== undefined) {
    updates.push(`password = $${paramIndex++}`);
    params.push(body.password);
  }

  if (body.service !== undefined) {
    updates.push(`service = $${paramIndex++}`);
    params.push(body.service);
  }

  if (body.smtp_host !== undefined) {
    updates.push(`smtp_host = $${paramIndex++}`);
    params.push(body.smtp_host);
  }

  if (body.smtp_port !== undefined) {
    updates.push(`smtp_port = $${paramIndex++}`);
    params.push(body.smtp_port);
  }

  if (body.smtp_user !== undefined) {
    updates.push(`smtp_user = $${paramIndex++}`);
    params.push(body.smtp_user);
  }

  if (body.daily_limit !== undefined) {
    updates.push(`daily_limit = $${paramIndex++}`);
    params.push(body.daily_limit);
  }

  if (updates.length === 0) {
    return errorResponse(400, 'No valid fields to update');
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  try {
    await dbRun(
      `UPDATE email_senders SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params,
    );

    const updated = await dbGet<EmailSender>(
      `
      SELECT
        id, name, email, service, smtp_host, smtp_port, smtp_user,
        daily_limit, is_active, sent_today, last_reset_date, created_at, updated_at
      FROM email_senders
      WHERE id = $1
      `,
      [id],
    );

    return successResponse(updated, 'Sender updated successfully');
  } catch (err: unknown) {
    const error = err as { message?: string; code?: string };
    if (error.code === '23505') { // PostgreSQL unique violation error code
      return errorResponse(400, 'Email already exists');
    }
    throw error;
  }
});

// ============================================================================
// DELETE /api/senders/[id] - Delete sender
// ============================================================================

export const DELETE = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  // Check if sender exists
  const existing = await dbGet<{ id: number }>(
    'SELECT id FROM email_senders WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Sender not found');
  }

  // Check if sender has pending emails
  const pendingCount = await dbGet<{ count: string }>(
    'SELECT COUNT(*) as count FROM email_queue WHERE sender_id = $1 AND status IN (\'queued\', \'sending\')',
    [id],
  );

  if (pendingCount && parseInt(pendingCount.count, 10) > 0) {
    return errorResponse(400, 'Cannot delete sender with pending emails. Reassign or cancel them first.');
  }

  // Delete the sender
  await dbRun('DELETE FROM email_senders WHERE id = $1', [id]);

  return successResponse({ id }, 'Sender deleted successfully');
});
