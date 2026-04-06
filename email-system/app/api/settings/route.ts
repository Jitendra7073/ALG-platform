/**
 * GET /api/settings - Get email system settings
 * PUT /api/settings - Update email system settings
 */

import { NextRequest } from 'next/server';
import {
  dbAll,
  dbRun,
} from '../db';
import {
  successResponse,
  withErrorHandler,
} from '../validation';
import { EmailSetting, SystemSettings } from '../types';

// ============================================================================
// GET /api/settings - Get all settings
// ============================================================================

export const GET = withErrorHandler(async () => {
  const settings = await dbAll<EmailSetting>(
    'SELECT key, value, label, description, updated_at FROM email_settings ORDER BY key',
  );

  // Convert to a more usable object format
  const settingsObj: Record<string, string> = {};
  for (const setting of settings) {
    settingsObj[setting.key] = setting.value;
  }

  return successResponse({
    settings,
    values: settingsObj,
  });
});

// ============================================================================
// PUT /api/settings - Update settings
// ============================================================================

export const PUT = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();

  if (!body.settings || typeof body.settings !== 'object') {
    return Response.json(
      { success: false, error: 'settings object is required' },
      { status: 400 },
    );
  }

  const updates: Array<{ key: string; value: string }> = [];

  for (const [key, value] of Object.entries(body.settings)) {
    if (typeof value === 'string' || typeof value === 'number') {
      updates.push({ key, value: String(value) });
    }
  }

  // Update each setting
  for (const { key, value } of updates) {
    await dbRun(
      `
      UPDATE email_settings
      SET value = $1, updated_at = CURRENT_TIMESTAMP
      WHERE key = $2
      `,
      [value, key],
    );
  }

  return successResponse(
    { updated: updates.length },
    `Updated ${updates.length} setting(s)`,
  );
});
