/**
 * Trigger Auto AI Verification
 *
 * Enqueues all sites that are marked as WordPress but haven't been
 * successfully classified by AI yet.
 *
 * Usage:
 *   node queue-pending-ai.js
 */

const { run, get, all, query, healthCheck, initializePool } = require("../../database/db-adapter.js");
require("dotenv").config();

/**
 * Queue WordPress sites for AI processing
 */
async function queuePendingSites() {
  console.log("--- Triggering Auto AI Verification ---");

  // Initialize PostgreSQL pool
  await initializePool();

  // Enqueue all sites that are marked as WordPress but haven't been successfully classified by AI yet.
  const result = await run(
    `
    UPDATE sites
    SET ai_status = 'pending'
    WHERE is_wordpress = 1
      AND text_content IS NOT NULL
      AND text_content != ''
      AND (ai_status != 'completed' OR ai_is_wordpress IS NULL OR ai_is_genuine_match IS NULL)
  `,
  );

  console.log(
    ` Queued ${result.changes} "Unverified WP" sites for AI processing.`,
  );
}

// Run the queue operation
queuePendingSites().catch(console.error);
