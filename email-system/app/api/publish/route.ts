/**
 * POST /api/publish
 * Receive published lead data from WordPress detector system
 *
 * This endpoint receives contact data from the external WordPress detector system,
 * checks for duplicates in email_send_log, and adds new contacts to the contacts table.
 */

import { NextRequest } from 'next/server';
import {
  dbTransaction,
} from '../db';
import {
  getValidatedBody,
  successResponse,
  badRequest,
  withErrorHandler,
  validateEmail,
} from '../validation';
import type {
  PublishRequest,
  PublishResponse,
} from '../types';

/**
 * Contact record for database insertion
 */
interface ContactInsert {
  site_id: number;
  type: 'email' | 'phone' | 'linkedin';
  value: string;
  source_page: string | null;
  is_bouncing: boolean;
  bounce_reason: string | null;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate publish request structure
 */
function isValidPublishRequest(data: unknown): data is PublishRequest {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const request = data as Partial<PublishRequest>;

  if (!Array.isArray(request.contacts)) {
    return false;
  }

  // Validate each contact has required fields
  for (const contact of request.contacts) {
    if (
      typeof contact !== 'object' ||
      contact === null ||
      typeof contact.email !== 'string' ||
      typeof contact.site_url !== 'string'
    ) {
      return false;
    }
    // id is optional - used for tracking source contact in WordPress system
    // site_id is optional - some contacts may not have a site_id
  }

  return true;
}

/**
 * Normalize and validate an email address
 */
function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!validateEmail(trimmed)) {
    return null;
  }
  return trimmed;
}

// ============================================================================
// POST Handler
// ============================================================================

export const POST = withErrorHandler(async (request: NextRequest) => {
  // Parse and validate request body
  const body = await getValidatedBody<PublishRequest>(request, isValidPublishRequest);

  if (!body.contacts || body.contacts.length === 0) {
    return badRequest('No contacts provided in request');
  }

  // Initialize statistics
  const stats: PublishResponse = {
    total_received: body.contacts.length,
    processed: 0,
    added: 0,
    skipped: {
      duplicates: 0,
      invalid: 0,
    },
    errors: [],
  };

  // Process contacts in a transaction for data consistency
  try {
    await dbTransaction(async (trx) => {
      for (const publishedContact of body.contacts) {
        stats.processed++;

        const { email, site_id, site_url } = publishedContact;
        // Additional fields (country, category, is_wordpress) available for future use

        // Normalize email
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) {
          stats.skipped.invalid++;
          stats.errors.push({
            email,
            reason: 'Invalid email format',
          });
          continue;
        }

        // Check if email exists in email_send_log (duplicate detection)
        const existingLog = await trx.query<{ id: number }>(
          `SELECT id FROM email_send_log WHERE to_email = $1 LIMIT 1`,
          [normalizedEmail]
        );

        if (existingLog.rows.length > 0) {
          stats.skipped.duplicates++;
          continue;
        }

        // Check if contact already exists in contacts table
        // For contacts without site_id, only check by email value
        let existingContact;
        if (site_id && typeof site_id === 'number') {
          existingContact = await trx.query<{ id: number }>(
            `SELECT id FROM contacts WHERE site_id = $1 AND type = 'email' AND value = $2 LIMIT 1`,
            [site_id, normalizedEmail]
          );
        } else {
          // For contacts without site_id, check by email only
          existingContact = await trx.query<{ id: number }>(
            `SELECT id FROM contacts WHERE type = 'email' AND value = $1 LIMIT 1`,
            [normalizedEmail]
          );
        }

        if (existingContact.rows.length > 0) {
          stats.skipped.duplicates++;
          continue;
        }

        // Prepare contact for insertion
        const contactInsert: ContactInsert = {
          site_id: site_id || 0,
          type: 'email',
          value: normalizedEmail,
          source_page: site_url || null,
          is_bouncing: false,
          bounce_reason: null,
        };

        // Insert new contact
        const insertResult = await trx.query<{ id: number }>(
          `INSERT INTO contacts (site_id, type, value, source_page, is_bouncing, bounce_reason)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            contactInsert.site_id,
            contactInsert.type,
            contactInsert.value,
            contactInsert.source_page,
            contactInsert.is_bouncing,
            contactInsert.bounce_reason,
          ]
        );

        if (insertResult.rows.length > 0) {
          stats.added++;
        } else {
          stats.errors.push({
            email: normalizedEmail,
            reason: 'Failed to insert contact',
          });
        }
      }
    });

    // Add synced_count for backward compatibility with frontend
    const responseWithCount = {
      ...stats,
      synced_count: stats.added,
    };

    return successResponse<PublishResponse & { synced_count: number }>(responseWithCount, 'Contacts processed successfully');
  } catch (error) {
    console.error('[API /api/publish] Database error:', error);
    return badRequest(`Database error: ${(error as Error).message}`);
  }
});

// ============================================================================
// OPTIONS Handler (for CORS preflight)
// ============================================================================

export const OPTIONS = async () => {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
};
