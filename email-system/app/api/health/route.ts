/**
 * GET /api/health
 * Get system health status
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
  dbGet,
} from '../db';
import {
  successResponse,
  withErrorHandler,
} from '../validation';
import { WorkerHealthStatus } from '../types';

// ============================================================================
// GET /api/health - Get system health
// ============================================================================

export const GET = withErrorHandler(async () => {
  // Get active senders count
  const activeSendersResult = await dbGet<{ count: string }>(
    'SELECT COUNT(*) as count FROM email_senders WHERE is_active = true',
  );

  // Get queue counts by status
  const queueStats = await dbAll<{ status: string; count: string }>(
    'SELECT status, COUNT(*) as count FROM email_queue GROUP BY status',
  );

  const queueCounts: Record<string, number> = {
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const stat of queueStats) {
    queueCounts[stat.status] = parseInt(stat.count, 10);
  }

  // Get recent worker errors
  const recentErrors = await dbAll<{
    id: number;
    error_type: string;
    error_message: string;
    created_at: string;
  }>(
    `
    SELECT id, error_type, error_message, created_at
    FROM worker_errors
    WHERE created_at >= NOW() - INTERVAL '1 hour'
    ORDER BY created_at DESC
    LIMIT 10
    `,
  );

  // Get countries in business hours (simplified)
  const countriesInBusiness = getCountriesInBusiness();

  // Get database size for PostgreSQL
  const dbSizeResult = await dbGet<{ size: string }>(
    `SELECT pg_database_size(current_database()) as size`,
  );

  const health: WorkerHealthStatus = {
    is_running: true, // API is running
    is_paused: false, // No pause state in standalone API
    active_senders: activeSendersResult ? parseInt(activeSendersResult.count, 10) : 0,
    queued_emails: queueCounts.queued,
    uptime: process.uptime ? `${Math.floor(process.uptime())}s` : 'unknown',
    last_check: new Date().toISOString(),
    countries_in_business: countriesInBusiness,
    parallel_mode: true, // Default mode
    recent_errors: recentErrors,
  };

  return successResponse({
    health,
    queue_counts: queueCounts,
    database_size_bytes: dbSizeResult ? parseInt(dbSizeResult.size, 10) : 0,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get list of countries currently in business hours (9 AM - 6 PM local time)
 * This is a simplified version - for production, use a proper timezone library
 */
function getCountriesInBusiness(): Array<{ code: string; name: string; timezone: string }> {
  const now = new Date();
  const hour = now.getUTCHours();
  const countriesInBusiness: Array<{ code: string; name: string; timezone: string }> = [];

  // Country name mapping
  const countryNames: Record<string, string> = {
    uk: 'United Kingdom',
    de: 'Germany',
    fr: 'France',
    it: 'Italy',
    es: 'Spain',
    nl: 'Netherlands',
    se: 'Sweden',
    no: 'Norway',
    dk: 'Denmark',
    ch: 'Switzerland',
    at: 'Austria',
    pl: 'Poland',
    cz: 'Czech Republic',
    gr: 'Greece',
    pt: 'Portugal',
    in: 'India',
    us: 'United States',
    au: 'Australia',
    nz: 'New Zealand',
    sg: 'Singapore',
    my: 'Malaysia',
    th: 'Thailand',
    vn: 'Vietnam',
    ph: 'Philippines',
    hk: 'Hong Kong',
    tw: 'Taiwan',
    cn: 'China',
    jp: 'Japan',
    kr: 'South Korea',
    ae: 'United Arab Emirates',
    sa: 'Saudi Arabia',
    qa: 'Qatar',
    kw: 'Kuwait',
    br: 'Brazil',
    ar: 'Argentina',
    co: 'Colombia',
    cl: 'Chile',
    pe: 'Peru',
    za: 'South Africa',
    ke: 'Kenya',
    ng: 'Nigeria',
    eg: 'Egypt',
  };

  // Approximate business hours by timezone offset
  // Europe (UTC+1 to UTC+3): 8-17 UTC
  if (hour >= 8 && hour < 17) {
    for (const code of ['uk', 'de', 'fr', 'it', 'es', 'nl', 'se', 'no', 'dk', 'ch', 'at', 'pl', 'cz', 'gr', 'pt']) {
      countriesInBusiness.push({ code, name: countryNames[code] || code, timezone: 'Europe' });
    }
  }

  // India (UTC+5:30): 3:30-12:30 UTC
  if (hour >= 3 && hour < 13) {
    countriesInBusiness.push({ code: 'in', name: 'India', timezone: 'Asia/Kolkata' });
  }

  // US (UTC-5 to UTC-8): Various times
  if (hour >= 14 && hour < 23) {
    countriesInBusiness.push({ code: 'us', name: 'United States', timezone: 'America/New_York' });
  }

  // Australia (UTC+10 to UTC+11): 23-8 UTC (next day)
  if (hour >= 23 || hour < 8) {
    for (const code of ['au', 'nz']) {
      countriesInBusiness.push({ code, name: countryNames[code] || code, timezone: 'Australia/Sydney' });
    }
  }

  // Southeast Asia (UTC+7 to UTC+8): 1-9 UTC
  if (hour >= 1 && hour < 9) {
    for (const code of ['sg', 'my', 'th', 'vn', 'ph', 'hk', 'tw', 'cn']) {
      countriesInBusiness.push({ code, name: countryNames[code] || code, timezone: 'Asia/Singapore' });
    }
  }

  // Japan (UTC+9): 0-8 UTC
  if (hour >= 0 && hour < 8) {
    for (const code of ['jp', 'kr']) {
      countriesInBusiness.push({ code, name: countryNames[code] || code, timezone: 'Asia/Tokyo' });
    }
  }

  // Middle East (UTC+3 to UTC+4): 5-13 UTC
  if (hour >= 5 && hour < 13) {
    for (const code of ['ae', 'sa', 'qa', 'kw']) {
      countriesInBusiness.push({ code, name: countryNames[code] || code, timezone: 'Asia/Dubai' });
    }
  }

  // South America (UTC-3 to UTC-5): 12-20 UTC
  if (hour >= 12 && hour < 20) {
    for (const code of ['br', 'ar', 'co', 'cl', 'pe']) {
      countriesInBusiness.push({ code, name: countryNames[code] || code, timezone: 'America/Sao_Paulo' });
    }
  }

  // Africa (UTC+1 to UTC+3): 7-16 UTC
  if (hour >= 7 && hour < 16) {
    for (const code of ['za', 'ke', 'ng', 'eg']) {
      countriesInBusiness.push({ code, name: countryNames[code] || code, timezone: 'Africa/Johannesburg' });
    }
  }

  return countriesInBusiness;
}
