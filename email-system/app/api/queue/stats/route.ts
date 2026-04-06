/**
 * GET /api/queue/stats
 * Get queue statistics
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
} from '../../db';
import {
  successResponse,
  withErrorHandler,
} from '../../validation';
import { QueueStats } from '../../types';

// ============================================================================
// GET /api/queue/stats - Get queue statistics
// ============================================================================

export const GET = withErrorHandler(async () => {
  // Get counts by status
  const statusCounts = await dbAll<{ status: string; count: string }>(
    `
    SELECT status, COUNT(*) as count
    FROM email_queue
    GROUP BY status
    `,
  );

  const counts = {
    total: 0,
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const row of statusCounts) {
    const count = parseInt(row.count, 10);
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] = count;
    }
    counts.total += count;
  }

  // Get breakdown by country
  const byCountryRaw = await dbAll<{ country: string; count: string }>(
    `
    SELECT
      COALESCE(s.country, 'unknown') as country,
      COUNT(eq.id) as count
    FROM email_queue eq
    LEFT JOIN contacts c ON eq.contact_id = c.id
    LEFT JOIN sites s ON c.site_id = s.id
    WHERE eq.status = 'queued'
    GROUP BY COALESCE(s.country, 'unknown')
    ORDER BY count DESC
    `,
  );

  // Get countries currently in business hours
  const countriesInBusiness = getCountriesInBusiness();

  const byCountry = byCountryRaw.map((item) => ({
    country: item.country,
    count: parseInt(item.count, 10),
    inBusinessHours: countriesInBusiness.includes(item.country.toLowerCase()),
  }));

  const stats: QueueStats = {
    ...counts,
    byCountry,
  };

  return successResponse(stats);
});

/**
 * Get list of countries currently in business hours (9 AM - 6 PM local time)
 * This is a simplified version - for production, use a proper timezone library
 */
function getCountriesInBusiness(): string[] {
  const now = new Date();
  const hour = now.getUTCHours();
  const countriesInBusiness: string[] = [];

  // Approximate business hours by timezone offset
  // This is simplified - use luxon or date-fns-tz for production

  // Europe (UTC+1 to UTC+3): 8-17 UTC
  if (hour >= 8 && hour < 17) {
    countriesInBusiness.push('uk', 'de', 'fr', 'it', 'es', 'nl', 'se', 'no', 'dk', 'ch', 'at', 'pl', 'cz', 'gr', 'pt');
  }

  // India (UTC+5:30): 3:30-12:30 UTC
  if (hour >= 3 && hour < 13) {
    countriesInBusiness.push('in');
  }

  // US East (UTC-5): 14-23 UTC
  if (hour >= 14 && hour < 23) {
    countriesInBusiness.push('us');
  }

  // US West (UTC-8): 17-2 UTC (next day)
  if (hour >= 17 || hour < 2) {
    countriesInBusiness.push('us');
  }

  // Australia (UTC+10 to UTC+11): 23-8 UTC (next day)
  if (hour >= 23 || hour < 8) {
    countriesInBusiness.push('au', 'nz');
  }

  // Singapore (UTC+8): 1-9 UTC
  if (hour >= 1 && hour < 9) {
    countriesInBusiness.push('sg', 'my', 'th', 'vn', 'ph', 'hk', 'tw', 'cn');
  }

  // Japan (UTC+9): 0-8 UTC
  if (hour >= 0 && hour < 8) {
    countriesInBusiness.push('jp', 'kr');
  }

  // UAE (UTC+4): 5-13 UTC
  if (hour >= 5 && hour < 13) {
    countriesInBusiness.push('ae', 'sa', 'qa', 'kw');
  }

  // Brazil (UTC-3): 12-20 UTC
  if (hour >= 12 && hour < 20) {
    countriesInBusiness.push('br', 'ar', 'co', 'cl', 'pe');
  }

  // South Africa (UTC+2): 7-16 UTC
  if (hour >= 7 && hour < 16) {
    countriesInBusiness.push('za', 'ke', 'ng', 'eg');
  }

  return countriesInBusiness;
}
