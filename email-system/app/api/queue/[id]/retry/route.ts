/**
 * POST /api/queue/[id]/retry
 * Retry a failed queue item
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
  withErrorHandler,
} from '../../../validation';

// ============================================================================
// POST /api/queue/[id]/retry - Retry failed queue item
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  // Check if item exists
  const existing = await dbGet<{ status: string; attempts: number }>(
    'SELECT status, attempts FROM email_queue WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Queue item not found');
  }

  // Only allow retrying failed items
  if (existing.status !== 'failed') {
    return errorResponse(400, 'Can only retry failed emails');
  }

  // Reset to queued with incremented attempt count
  await dbRun(
    `
    UPDATE email_queue
    SET status = 'queued',
        attempts = $1,
        error_message = NULL,
        scheduled_at = NULL
    WHERE id = $2
    `,
    [existing.attempts + 1, id],
  );

  return successResponse({ id }, 'Email queued for retry');
});
