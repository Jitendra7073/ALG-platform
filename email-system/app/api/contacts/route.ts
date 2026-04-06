/**
 * GET /api/contacts
 * Get contacts with optional filtering and pagination
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
  successResponse,
  withErrorHandler,
} from '../validation';
import { Contact, ContactWithSite, PaginatedResponse } from '../types';

// ============================================================================
// GET /api/contacts - Get contacts
// ============================================================================

export const GET = withErrorHandler(async (request: NextRequest) => {
  const url = new URL(request.url);
  const pagination = getPaginationParams(url);

  // Build query conditions
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Filter by site_id
  const siteId = getQueryNumber(url, 'site_id');
  if (siteId) {
    conditions.push(`c.site_id = $${paramIndex++}`);
    params.push(siteId);
  }

  // Filter by type
  const type = getQueryParam(url, 'type');
  if (type && ['email', 'phone', 'linkedin'].includes(type)) {
    conditions.push(`c.type = $${paramIndex++}`);
    params.push(type);
  }

  // Search by value
  const search = getQueryParam(url, 'search');
  if (search) {
    conditions.push(`c.value LIKE $${paramIndex++}`);
    params.push(`%${search}%`);
  }

  // Build WHERE clause
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await dbGet<{ count: string }>(
    `SELECT COUNT(*) as count FROM contacts c ${whereClause}`,
    params,
  );
  const total = countResult ? parseInt(countResult.count, 10) : 0;

  // Get paginated results
  params.push(pagination.limit!, pagination.offset!);
  const items = await dbAll<ContactWithSite>(
    `
    SELECT c.*,
           s.url as site_url,
           s.country as site_country
    FROM contacts c
    LEFT JOIN sites s ON c.site_id = s.id
    ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `,
    params,
  );

  return successResponse<PaginatedResponse<ContactWithSite>>({
    data: items,
    pagination: getPaginationMeta(pagination, total),
  });
});
