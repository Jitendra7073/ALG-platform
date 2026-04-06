/**
 * POST /api/campaigns/[id]/start
 * Start a campaign (queue all emails)
 */

import { NextRequest } from 'next/server';
import {
  dbGet,
  dbRun,
  dbAll,
} from '../../../../db';
import {
  errorResponse,
  getIdParam,
  notFound,
  successResponse,
  withErrorHandler,
} from '../../../../validation';

interface StartCampaignRequest {
  send_immediately?: boolean;
  scheduled_at?: string;
}

// ============================================================================
// POST /api/campaigns/[id]/start - Start campaign
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest, context: { params: { id: string } }) => {
  const id = getIdParam(context.params);
  const body = await request.json() as StartCampaignRequest;

  // Check if campaign exists
  const campaign = await dbGet<{
    id: number;
    name: string;
    template_id: number | null;
    target_type: string;
    status: string;
  }>(
    'SELECT id, name, template_id, target_type, status FROM email_campaigns WHERE id = $1',
    [id],
  );

  if (!campaign) {
    return notFound('Campaign not found');
  }

  // Don't start already running campaigns
  if (campaign.status === 'running') {
    return errorResponse(400, 'Campaign is already running');
  }

  // Get template if specified
  let template: { subject: string; html_content: string; text_content: string | null; tags: string } | null = null;

  if (campaign.template_id) {
    template = await dbGet<{
      subject: string;
      html_content: string;
      text_content: string | null;
      tags: string;
    }>(
      'SELECT subject, html_content, text_content, tags FROM email_templates WHERE id = $1',
      [campaign.template_id],
    );
  }

  // Get contacts based on target type
  let contacts: Array<{
    id: number;
    value: string;
    site_id: number;
  }> = [];

  if (campaign.target_type === 'all') {
    contacts = await dbAll(
      "SELECT id, value, site_id FROM contacts WHERE type = 'email'",
    );
  } else if (campaign.target_type === 'wordpress') {
    contacts = await dbAll(
      `
      SELECT c.id, c.value, c.site_id
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'email' AND s.is_wordpress = true
      `,
    );
  } else if (campaign.target_type === 'ai_verified') {
    contacts = await dbAll(
      `
      SELECT c.id, c.value, c.site_id
      FROM contacts c
      INNER JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'email' AND s.ai_content_relevant = true
      `,
    );
  }

  // Filter out contacts that have already received this campaign
  const existingContacts = await dbAll<{ contact_id: number }>(
    'SELECT DISTINCT contact_id FROM email_send_log WHERE campaign_id = $1',
    [id],
  );

  const existingContactIds = new Set(existingContacts.map((c) => c.contact_id));
  contacts = contacts.filter((c) => !existingContactIds.has(c.id));

  if (contacts.length === 0) {
    return errorResponse(400, 'No contacts to send to (all already contacted or no matching contacts)');
  }

  // Queue emails
  let queuedCount = 0;
  const scheduledAt = body.scheduled_at || null;

  for (const contact of contacts) {
    let subject = 'No Subject';
    let htmlContent = '<p>No content</p>';
    let textContent = null;
    let tag = null;

    if (template) {
      subject = template.subject;
      htmlContent = template.html_content;
      textContent = template.text_content;
      tag = template.tags;
    }

    // Get country code for timezone scheduling
    const site = await dbGet<{ country: string }>(
      'SELECT country FROM sites WHERE id = $1',
      [contact.site_id],
    );

    await dbRun(
      `
      INSERT INTO email_queue (
        campaign_id, contact_id, recipient_email, recipient_name,
        subject, html_content, text_content, tag, country_code,
        scheduled_at, status
      ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, 'queued')
      `,
      [
        id,
        contact.id,
        contact.value,
        subject,
        htmlContent,
        textContent,
        tag,
        site?.country || null,
        scheduledAt,
      ],
    );

    queuedCount++;
  }

  // Update campaign status
  await dbRun(
    `
    UPDATE email_campaigns
    SET status = 'running',
        started_at = CURRENT_TIMESTAMP,
        total_recipients = total_recipients + $1
    WHERE id = $2
    `,
    [queuedCount, id],
  );

  return successResponse(
    {
      campaign_id: id,
      queued: queuedCount,
    },
    `Campaign started with ${queuedCount} emails queued`,
  );
});
