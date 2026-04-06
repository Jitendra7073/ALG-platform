/**
 * POST /api/queue/bulk/cancel
 * Cancel multiple queue items
 */

import { NextRequest } from 'next/server';
import {
  dbRun,
} from '../../../db';
import {
  errorResponse,
  successResponse,
  withErrorHandler,
} from '../../../validation';

interface BulkCancelRequest {
  queue_ids: number[];
}

// ============================================================================
// POST /api/queue/bulk/cancel - Cancel multiple queue items
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json() as BulkCancelRequest;

  if (!body.queue_ids || !Array.isArray(body.queue_ids) || body.queue_ids.length === 0) {
    return errorResponse(400, 'queue_ids array is required');
  }

  // Limit bulk operations to prevent abuse
  if (body.queue_ids.length > 1000) {
    return errorResponse(400, 'Cannot cancel more than 1000 items at once');
  }

  // Build placeholders for IN clause: $1, $2, $3, ...
  const placeholders = body.queue_ids.map((_, i) => `$${i + 1}`).join(',');

  // Only cancel queued or failed items, not sent ones
  const result = await dbRun(
    `
    UPDATE email_queue
    SET status = 'cancelled'
    WHERE id IN (${placeholders})
      AND status IN ('queued', 'failed', 'sending')
    `,
    body.queue_ids,
  );

  return successResponse(
    {
      cancelled: result.changes,
    },
    `Cancelled ${result.changes} email(s)`,
  );
});
