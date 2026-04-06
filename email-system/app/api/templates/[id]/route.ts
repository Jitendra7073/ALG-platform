/**
 * GET /api/templates/[id] - Get a single template
 * PUT /api/templates/[id] - Update a template
 * DELETE /api/templates/[id] - Delete a template
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
import { EmailTemplate, UpdateTemplateRequest } from '../../../types';

// ============================================================================
// GET /api/templates/[id] - Get single template
// ============================================================================

export const GET = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  const template = await dbGet<EmailTemplate>(
    'SELECT * FROM email_templates WHERE id = $1',
    [id],
  );

  if (!template) {
    return notFound('Template not found');
  }

  return successResponse(template);
});

// ============================================================================
// PUT /api/templates/[id] - Update template
// ============================================================================

export const PUT = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);
  const body = await request.json() as UpdateTemplateRequest;

  // Check if template exists
  const existing = await dbGet<EmailTemplate>(
    'SELECT * FROM email_templates WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Template not found');
  }

  // Build update query dynamically
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (body.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    params.push(body.name);
  }

  if (body.subject !== undefined) {
    updates.push(`subject = $${paramIndex++}`);
    params.push(body.subject);
  }

  if (body.html_content !== undefined) {
    updates.push(`html_content = $${paramIndex++}`);
    params.push(body.html_content);
  }

  if (body.text_content !== undefined) {
    updates.push(`text_content = $${paramIndex++}`);
    params.push(body.text_content);
  }

  if (body.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(body.description);
  }

  if (body.category !== undefined) {
    updates.push(`category = $${paramIndex++}`);
    params.push(body.category);
  }

  if (body.tags !== undefined) {
    updates.push(`tags = $${paramIndex++}`);
    params.push(body.tags);
  }

  if (body.sequence_number !== undefined) {
    updates.push(`sequence_number = $${paramIndex++}`);
    params.push(body.sequence_number);
  }

  if (body.is_active !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    params.push(body.is_active);
  }

  if (updates.length === 0) {
    return errorResponse(400, 'No valid fields to update');
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  await dbRun(
    `UPDATE email_templates SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    params,
  );

  const updated = await dbGet<EmailTemplate>(
    'SELECT * FROM email_templates WHERE id = $1',
    [id],
  );

  return successResponse(updated, 'Template updated successfully');
});

// ============================================================================
// DELETE /api/templates/[id] - Delete template
// ============================================================================

export const DELETE = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  // Check if template exists
  const existing = await dbGet<EmailTemplate>(
    'SELECT id FROM email_templates WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Template not found');
  }

  // Check if template is used by any active campaigns
  const campaignCount = await dbGet<{ count: string }>(
    'SELECT COUNT(*) as count FROM email_campaigns WHERE template_id = $1 AND status IN (\'queued\', \'running\')',
    [id],
  );

  if (campaignCount && parseInt(campaignCount.count, 10) > 0) {
    return errorResponse(400, 'Cannot delete template used by active campaigns');
  }

  // Delete the template
  await dbRun('DELETE FROM email_templates WHERE id = $1', [id]);

  return successResponse({ id }, 'Template deleted successfully');
});
