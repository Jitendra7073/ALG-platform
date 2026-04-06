/**
 * GET /api/templates - Get email templates
 * POST /api/templates - Create a new email template
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
  dbGet,
  dbRun,
} from '../db';
import {
  errorResponse,
  getQueryParam,
  successResponse,
  validateRequired,
  withErrorHandler,
} from '../validation';
import { EmailTemplate, CreateTemplateRequest } from '../types';

// ============================================================================
// GET /api/templates - Get templates
// ============================================================================

export const GET = withErrorHandler(async (request: NextRequest) => {
  const url = new URL(request.url);
  const tag = getQueryParam(url, 'tag');
  const category = getQueryParam(url, 'category');
  const activeOnly = getQueryParam(url, 'active') === 'true';

  let query = `
    SELECT
      id, name, subject, html_content, text_content,
      description, category, tags, sequence_number, is_active,
      created_at, updated_at
    FROM email_templates
  `;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (tag) {
    conditions.push(`tags LIKE $${paramIndex++}`);
    params.push(`%${tag}%`);
  }

  if (category) {
    conditions.push(`category = $${paramIndex++}`);
    params.push(category);
  }

  if (activeOnly) {
    conditions.push(`is_active = true`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ` ORDER BY sequence_number ASC, created_at DESC`;

  const templates = await dbAll<EmailTemplate>(query, params);

  return successResponse(templates);
});

// ============================================================================
// POST /api/templates - Create template
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json() as CreateTemplateRequest;

  // Validate required fields
  const error = validateRequired(body, ['name', 'subject', 'html_content']);
  if (error) {
    return errorResponse(400, error);
  }

  // Auto-calculate sequence_number if not provided
  let sequenceNumber = body.sequence_number || 0;

  if (!sequenceNumber) {
    // Get the max sequence number for this tag+category combination
    const primaryTag = body.tags?.split(',')[0]?.trim() || '';

    let maxSeqResult;
    if (primaryTag) {
      maxSeqResult = await dbGet<{ max_seq: string }>(
        `SELECT COALESCE(MAX(sequence_number), 0) as max_seq
         FROM email_templates
         WHERE category = $1 AND tags LIKE $2`,
        [body.category || 'general', `%${primaryTag}%`],
      );
    } else {
      maxSeqResult = await dbGet<{ max_seq: string }>(
        `SELECT COALESCE(MAX(sequence_number), 0) as max_seq
         FROM email_templates
         WHERE category = $1`,
        [body.category || 'general'],
      );
    }

    sequenceNumber = (maxSeqResult ? parseInt(maxSeqResult.max_seq, 10) : 0) + 1;
  }

  const result = await dbRun(
    `
    INSERT INTO email_templates (
      name, subject, html_content, text_content,
      description, category, tags, sequence_number
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [
      body.name,
      body.subject,
      body.html_content,
      body.text_content || null,
      body.description || null,
      body.category || 'general',
      body.tags || '',
      sequenceNumber,
    ],
  );

  const newTemplate = await dbGet<EmailTemplate>(
    'SELECT * FROM email_templates WHERE id = $1',
    [result.lastInsertRowid],
  );

  return successResponse(newTemplate, 'Template created successfully');
});
