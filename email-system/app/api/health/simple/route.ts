/**
 * GET /api/health/simple
 * Simple health check endpoint for debugging connection issues
 *
 * Tests database connection with minimal queries
 * Returns basic status without complex operations
 */

import { NextRequest } from 'next/server';
import { successResponse, withErrorHandler } from '../../validation';

// ============================================================================
// GET /api/health/simple - Simple database connection test
// ============================================================================

export const GET = withErrorHandler(async () => {
  const startTime = Date.now();
  const results: {
    database: {
      connected: boolean;
      latency_ms: number;
      error?: string;
    };
    environment: {
      node_env: string;
      database_url_set: boolean;
      db_host?: string;
      db_port?: string;
      db_name?: string;
      db_user?: string;
    };
    timestamp: string;
  } = {
    database: {
      connected: false,
      latency_ms: 0,
    },
    environment: {
      node_env: process.env.NODE_ENV || 'unknown',
      database_url_set: !!process.env.DATABASE_URL,
    },
    timestamp: new Date().toISOString(),
  };

  // Parse DATABASE_URL for environment info
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      results.environment.db_host = url.hostname;
      results.environment.db_port = url.port || '5432';
      results.environment.db_name = url.pathname.slice(1) || 'postgres';
      results.environment.db_user = url.username;
    } catch {
      results.environment.db_host = 'invalid';
    }
  }

  // Test database connection
  try {
    // Dynamic import of pg to avoid issues when not installed
    const pg = await import('pg');
    const { Pool } = pg;

    // Create a minimal pool for connection testing
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
    });

    // Simple ping query
    await pool.query('SELECT 1 as ping');
    results.database.connected = true;
    results.database.latency_ms = Date.now() - startTime;

    // Close the test pool
    await pool.end();
  } catch (error) {
    results.database.connected = false;
    results.database.error = error instanceof Error ? error.message : String(error);
    results.database.latency_ms = Date.now() - startTime;
  }

  return successResponse(results);
});
