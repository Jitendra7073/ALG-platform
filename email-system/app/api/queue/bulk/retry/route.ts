/**
 * POST /api/queue/bulk/retry
 * Retry multiple failed queue items
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

interface BulkRetryRequest {
  queue_ids?: number[];
  all_failed?: boolean;
}

// ============================================================================
// POST /api/queue/bulk/retry - Retry multiple failed queue items
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json() as BulkRetryRequest;

  let result;

  if (body.all_failed) {
    // Retry ALL failed emails
    result = await dbRun(
      `
      UPDATE email_queue
      SET status = 'queued',
          attempts = attempts + 1,
          error_message = NULL,
          scheduled_at = NULL
      WHERE status = 'failed'
      `,
    );
  } else if (body.queue_ids && Array.isArray(body.queue_ids) && body.queue_ids.length > 0) {
    // Limit bulk operations
    if (body.queue_ids.length > 1000) {
      return errorResponse(400, 'Cannot retry more than 1000 items at once');
    }

    // Build placeholders for IN clause: $1, $2, $3, ...
    const placeholders = body.queue_ids.map((_, i) => `$${i + 1}`).join(',');

    result = await dbRun(
      `
      UPDATE email_queue
      SET status = 'queued',
          attempts = attempts + 1,
          error_message = NULL,
          scheduled_at = NULL
      WHERE id IN (${placeholders})
        AND status = 'failed'
      `,
      body.queue_ids,
    );
  } else {
    return errorResponse(400, 'Either queue_ids array or all_failed=true is required');
  }

  return successResponse(
    {
      retried: result.changes,
    },
    `Retried ${result.changes} email(s)`,
  );
});
