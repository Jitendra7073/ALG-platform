/**
 * GET /api/leads
 * Get leads (sites with contacts) for email campaigns
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
  dbGet,
} from '../db';
import {
  getPaginationParams,
  getPaginationMeta,
  getQueryNumber,
  getQueryParam,
  getQueryBoolean,
  successResponse,
  withErrorHandler,
} from '../validation';
import { Lead, PaginatedResponse } from '../types';

// ============================================================================
// GET /api/leads - Get leads
// ============================================================================

export const GET = withErrorHandler(async (request: NextRequest) => {
  const url = new URL(request.url);
  const pagination = getPaginationParams(url);

  // Build query conditions
  const conditions: string[] = ['s.is_wordpress = true'];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Filter by country
  const country = getQueryParam(url, 'country');
  if (country) {
    conditions.push(`s.country = $${paramIndex++}`);
    params.push(country.toUpperCase());
  }

  // Filter by AI relevance
  const onlyRelevant = getQueryBoolean(url, 'relevant_only');
  if (onlyRelevant) {
    conditions.push(`s.ai_content_relevant = true`);
  }

  // Filter by tag
  const tag = getQueryParam(url, 'tag');
  if (tag) {
    conditions.push(`s.tags LIKE $${paramIndex++}`);
    params.push(`%${tag}%`);
  }

  // Only include sites with email contacts
  const onlyWithEmail = getQueryBoolean(url, 'with_email', true);
  if (onlyWithEmail) {
    conditions.push(`EXISTS (SELECT 1 FROM contacts WHERE site_id = s.id AND type = 'email')`);
  }

  // Build WHERE clause
  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Get total count
  const countResult = await dbGet<{ count: string }>(
    `SELECT COUNT(*) as count FROM sites s ${whereClause}`,
    params,
  );
  const total = countResult ? parseInt(countResult.count, 10) : 0;

  // Get paginated results
  params.push(pagination.limit!, pagination.offset!);
  const sites = await dbAll<{
    id: number;
    url: string;
    country: string;
    tags: string;
    ai_content_relevant: boolean;
  }>(
    `
    SELECT
      s.id,
      s.url,
      s.country,
      s.tags,
      s.ai_content_relevant
    FROM sites s
    ${whereClause}
    ORDER BY s.checked_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `,
    params,
  );

  // Get contacts for each site and build lead objects
  const leads: Lead[] = [];

  for (const site of sites) {
    const contacts = await dbAll<{
      id: number;
      type: string;
      value: string;
    }>(
      'SELECT id, type, value FROM contacts WHERE site_id = $1',
      [site.id],
    );

    const emails = contacts.filter((c) => c.type === 'email');
    const phones = contacts.filter((c) => c.type === 'phone');
    const linkedins = contacts.filter((c) => c.type === 'linkedin');

    // Get email count from send log
    const emailCountResult = await dbGet<{ count: string }>(
      `SELECT COUNT(*) as count FROM email_send_log WHERE contact_id IN (SELECT id FROM contacts WHERE site_id = $1)`,
      [site.id],
    );

    // Get last emailed date
    const lastEmailedResult = await dbGet<{ sent_at: string }>(
      `SELECT MAX(sent_at) as sent_at FROM email_send_log WHERE contact_id IN (SELECT id FROM contacts WHERE site_id = $1)`,
      [site.id],
    );

    leads.push({
      id: site.id,
      site_id: site.id,
      site_url: site.url,
      site_country: site.country,
      contacts: contacts,
      total_emails: emails.length,
      total_phones: phones.length,
      total_linkedin: linkedins.length,
      email_count: emailCountResult ? parseInt(emailCountResult.count, 10) : 0,
      last_emailed_at: lastEmailedResult?.sent_at || null,
    });
  }

  return successResponse<PaginatedResponse<Lead>>({
    data: leads,
    pagination: getPaginationMeta(pagination, total),
  });
});
