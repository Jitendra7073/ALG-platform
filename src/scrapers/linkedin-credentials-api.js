/**
 * LinkedIn Credentials API
 *
 * Provides REST API endpoints for managing LinkedIn credentials
 * used by the LinkedIn company scraper.
 *
 * Endpoints:
 * - GET    /api/linkedin/credentials       - Get all credentials
 * - POST   /api/linkedin/credentials       - Add new credentials
 * - PUT    /api/linkedin/credentials/:id   - Update credentials
 * - DELETE /api/linkedin/credentials/:id   - Delete credentials
 * - GET    /api/linkedin/credentials/active - Get active credential
 */

const express = require("express");
const router = express.Router();
const db = require("../database/database.js");

/**
 * Initialize LinkedIn credentials table
 */
function initializeLinkedInCredentialsTable() {
  db.run(`
    CREATE TABLE IF NOT EXISTS linkedin_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      password TEXT,
      is_active INTEGER DEFAULT 1,
      last_used DATETIME,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log(" LinkedIn credentials table initialized");
}

// Initialize table on module load
initializeLinkedInCredentialsTable();

/**
 * GET /api/linkedin/credentials
 * Get all LinkedIn credentials
 */
router.get("/", (req, res) => {
  try {
    const credentials = db.all(`
      SELECT id, name, email, is_active, last_used, notes, created_at, updated_at
      FROM linkedin_credentials
      ORDER BY is_active DESC, created_at DESC
    `);

    // Mask passwords in response
    const maskedCredentials = credentials.map((cred) => ({
      ...cred,
      password: cred.password ? "********" : null,
    }));

    res.json({ success: true, data: maskedCredentials });
  } catch (error) {
    console.error("Error fetching LinkedIn credentials:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/linkedin/credentials/active
 * Get the active LinkedIn credential
 */
router.get("/active", (req, res) => {
  try {
    const credential = db.get(`
      SELECT id, name, email, is_active, last_used, notes, created_at, updated_at
      FROM linkedin_credentials
      WHERE is_active = 1
      ORDER BY last_used DESC
      LIMIT 1
    `);

    if (!credential) {
      return res.json({ success: true, data: null });
    }

    // Mask password
    const maskedCredential = {
      ...credential,
      password: "********",
    };

    res.json({ success: true, data: maskedCredential });
  } catch (error) {
    console.error("Error fetching active LinkedIn credential:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/linkedin/credentials/:id
 * Get a specific LinkedIn credential by ID (includes password for use in scraper)
 */
router.get("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const credential = db.get(
      `
      SELECT *
      FROM linkedin_credentials
      WHERE id = ?
    `,
      [id],
    );

    if (!credential) {
      return res
        .status(404)
        .json({ success: false, error: "Credential not found" });
    }

    // Return full credential with password (for internal use by scraper)
    res.json({ success: true, data: credential });
  } catch (error) {
    console.error("Error fetching LinkedIn credential:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/linkedin/credentials
 * Add new LinkedIn credentials
 */
router.post("/", (req, res) => {
  try {
    const { name, email, password, notes } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, error: "Name is required" });
    }

    const result = db.run(
      `
      INSERT INTO linkedin_credentials (name, email, password, notes)
      VALUES (?, ?, ?, ?)
    `,
      [name, email || null, password || null, notes || null],
    );

    const newCredential = db.get(
      `
      SELECT id, name, email, is_active, notes, created_at
      FROM linkedin_credentials
      WHERE id = ?
    `,
      [result.lastInsertRowid],
    );

    res.status(201).json({
      success: true,
      data: {
        ...newCredential,
        password: newCredential.password ? "********" : null,
      },
    });
  } catch (error) {
    console.error("Error adding LinkedIn credentials:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/linkedin/credentials/:id
 * Update LinkedIn credentials
 */
router.put("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, notes, is_active } = req.body;

    // Check if credential exists
    const existing = db.get("SELECT * FROM linkedin_credentials WHERE id = ?", [
      id,
    ]);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, error: "Credential not found" });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push("name = ?");
      values.push(name);
    }
    if (email !== undefined) {
      updates.push("email = ?");
      values.push(email);
    }
    if (password !== undefined) {
      updates.push("password = ?");
      values.push(password);
    }
    if (notes !== undefined) {
      updates.push("notes = ?");
      values.push(notes);
    }
    if (is_active !== undefined) {
      updates.push("is_active = ?");
      values.push(is_active);
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    db.run(
      `
      UPDATE linkedin_credentials
      SET ${updates.join(", ")}
      WHERE id = ?
    `,
      values,
    );

    const updated = db.get(
      `
      SELECT id, name, email, is_active, last_used, notes, created_at, updated_at
      FROM linkedin_credentials
      WHERE id = ?
    `,
      [id],
    );

    res.json({
      success: true,
      data: {
        ...updated,
        password: updated.password ? "********" : null,
      },
    });
  } catch (error) {
    console.error("Error updating LinkedIn credentials:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/linkedin/credentials/:id
 * Delete LinkedIn credentials
 */
router.delete("/:id", (req, res) => {
  try {
    const { id } = req.params;

    const result = db.run(
      `
      DELETE FROM linkedin_credentials
      WHERE id = ?
    `,
      [id],
    );

    if (result.changes === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Credential not found" });
    }

    res.json({ success: true, message: "Credential deleted successfully" });
  } catch (error) {
    console.error("Error deleting LinkedIn credentials:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/linkedin/credentials/:id/set-active
 * Set a credential as active
 */
router.post("/:id/set-active", (req, res) => {
  try {
    const { id } = req.params;

    // Check if credential exists
    const existing = db.get("SELECT * FROM linkedin_credentials WHERE id = ?", [
      id,
    ]);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, error: "Credential not found" });
    }

    // Deactivate all credentials
    db.run("UPDATE linkedin_credentials SET is_active = 0");

    // Activate selected credential
    db.run(
      "UPDATE linkedin_credentials SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id],
    );

    res.json({ success: true, message: "Credential set as active" });
  } catch (error) {
    console.error("Error setting active credential:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/linkedin/credentials/:id/mark-used
 * Mark credential as used (updates last_used timestamp)
 */
router.post("/:id/mark-used", (req, res) => {
  try {
    const { id } = req.params;

    db.run(
      `
      UPDATE linkedin_credentials
      SET last_used = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [id],
    );

    res.json({ success: true, message: "Credential marked as used" });
  } catch (error) {
    console.error("Error marking credential as used:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
