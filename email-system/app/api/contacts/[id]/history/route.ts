/**
 * GET /api/contacts/[id]/history
 * Get email send history for a specific contact
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
  dbGet,
} from '../../../../db';
import {
  errorResponse,
  getIdParam,
  notFound,
  successResponse,
  withErrorHandler,
} from '../../../../validation';
import { EmailSendLog } from '../../../../types';

// ============================================================================
// GET /api/contacts/[id]/history - Get contact email history
// ============================================================================

export const GET = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);

  // Check if contact exists
  const contact = await dbGet<{ id: number; value: string }>(
    'SELECT id, value FROM contacts WHERE id = $1',
    [id],
  );

  if (!contact) {
    return notFound('Contact not found');
  }

  // Get email history
  const history = await dbAll<EmailSendLog>(
    `
    SELECT
      esl.*,
      et.name as template_name,
      ec.name as campaign_name
    FROM email_send_log esl
    LEFT JOIN email_templates et ON esl.template_id = et.id
    LEFT JOIN email_campaigns ec ON esl.campaign_id = ec.id
    WHERE esl.contact_id = $1
    ORDER BY esl.sent_at DESC
    `,
    [id],
  );

  // Get summary stats
  const stats = await dbGet<{ total: string; sent: string; failed: string }>(
    `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM email_send_log
    WHERE contact_id = $1
    `,
    [id],
  );

  return successResponse({
    contact: {
      id: contact.id,
      value: contact.value,
    },
    stats: stats ? {
      total: parseInt(stats.total, 10),
      sent: parseInt(stats.sent, 10),
      failed: parseInt(stats.failed, 10),
    } : { total: 0, sent: 0, failed: 0 },
    history,
  });
});
