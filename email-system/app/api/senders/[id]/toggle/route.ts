/**
 * POST /api/senders/[id]/toggle
 * Toggle sender active/inactive status
 */

import { NextRequest } from 'next/server';
import {
  dbGet,
  dbRun,
} from '../../../../db';
import {
  getIdParam,
  notFound,
  successResponse,
  withErrorHandler,
} from '../../../../validation';

// ============================================================================
// POST /api/senders/[id]/toggle - Toggle sender status
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  // Check if sender exists
  const existing = await dbGet<{ is_active: boolean }>(
    'SELECT is_active FROM email_senders WHERE id = $1',
    [id],
  );

  if (!existing) {
    return notFound('Sender not found');
  }

  const newStatus = !existing.is_active;

  await dbRun(
    `
    UPDATE email_senders
    SET is_active = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    `,
    [newStatus, id],
  );

  return successResponse(
    {
      id,
      is_active: newStatus,
    },
    newStatus ? 'Sender activated' : 'Sender deactivated',
  );
});
