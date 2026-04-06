/**
 * GET /api/templates/tags
 * Get all unique tags from email templates
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
} from '../../../db';
import {
  successResponse,
  withErrorHandler,
} from '../../../validation';

// ============================================================================
// GET /api/templates/tags - Get unique template tags
// ============================================================================

export const GET = withErrorHandler(async () => {
  const templates = await dbAll<{ tags: string }>(
    `SELECT tags FROM email_templates WHERE tags IS NOT NULL AND tags != ''`,
  );

  // Extract unique tags from all templates
  const tagsSet = new Set<string>();

  for (const template of templates) {
    if (template.tags) {
      for (const tag of template.tags.split(',')) {
        const trimmed = tag.trim();
        if (trimmed) {
          tagsSet.add(trimmed);
        }
      }
    }
  }

  const tags = Array.from(tagsSet).sort();

  return successResponse(tags);
});
