/**
 * GET /api/senders - Get email senders
 * POST /api/senders - Create a new sender
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
  dbGet,
  dbRun,
} from '../db';
import {
  errorResponse,
  successResponse,
  validateEmail,
  validateRequired,
  withErrorHandler,
} from '../validation';
import { EmailSender, CreateSenderRequest } from '../types';

// ============================================================================
// GET /api/senders - Get senders
// ============================================================================

export const GET = withErrorHandler(async () => {
  const senders = await dbAll<EmailSender>(
    `
    SELECT
      id, name, email, service, smtp_host, smtp_port, smtp_user,
      daily_limit, is_active, sent_today, last_reset_date, created_at, updated_at
    FROM email_senders
    ORDER BY created_at DESC
    `,
  );

  return successResponse(senders);
});

// ============================================================================
// POST /api/senders - Create sender
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json() as CreateSenderRequest;

  // Validate required fields
  const error = validateRequired(body, ['name', 'email', 'password']);
  if (error) {
    return errorResponse(400, error);
  }

  // Validate email format
  if (!validateEmail(body.email)) {
    return errorResponse(400, 'Invalid email address');
  }

  // Validate custom SMTP settings if provided
  if (body.service === 'custom' || body.service === 'smtp') {
    if (!body.smtp_host || !body.smtp_port) {
      return errorResponse(400, 'smtp_host and smtp_port are required for custom SMTP');
    }
  }

  try {
    const result = await dbRun(
      `
      INSERT INTO email_senders (
        name, email, password, service, smtp_host, smtp_port,
        smtp_user, daily_limit
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
      `,
      [
        body.name,
        body.email,
        body.password,
        body.service || 'gmail',
        body.smtp_host || null,
        body.smtp_port || null,
        body.smtp_user || null,
        body.daily_limit || 500,
      ],
    );

    const newSender = await dbGet<EmailSender>(
      `
      SELECT
        id, name, email, service, smtp_host, smtp_port, smtp_user,
        daily_limit, is_active, sent_today, last_reset_date, created_at, updated_at
      FROM email_senders
      WHERE id = $1
      `,
      [result.lastInsertRowid],
    );

    return successResponse(newSender, 'Sender created successfully');
  } catch (err: unknown) {
    const error = err as { message?: string; code?: string };
    if (error.code === '23505') { // PostgreSQL unique violation error code
      return errorResponse(400, 'Email already exists');
    }
    throw error;
  }
});
