/**
 * Timezone-Aware Email Campaign API Endpoints
 *
 * These endpoints integrate with the existing email system to provide
 * smart scheduling based on recipient timezone and business hours
 */

const express = require("express");
const router = express.Router();
const db = require("../../database/database.js");
const timezoneScheduler = require("../email/timezone-scheduler");

/**
 * Normalize country code to handle various input formats
 * - Trims whitespace
 * - Converts to lowercase
 * - Handles duplicates like "IN IN" -> "in"
 * - Handles malformed codes by extracting valid part
 * @param {string} code - The country code to normalize
 * @returns {string|null} - Normalized lowercase country code, or null if invalid
 */
function normalizeCountryCode(code) {
  if (!code) return null;

  // Convert to string, trim, uppercase
  let normalized = String(code).trim().toUpperCase();

  // Handle duplicate codes like "IN IN" -> extract first valid part
  // Split by space and take the first 2-letter valid code
  const parts = normalized.split(/\s+/);
  for (const part of parts) {
    // Check if it looks like a valid country code (2-3 letters)
    if (/^[A-Z]{2,3}$/.test(part)) {
      return part.toLowerCase();
    }
  }

  // If no valid part found, try first 2 chars of trimmed string
  if (normalized.length >= 2) {
    return normalized.substring(0, 2).toLowerCase();
  }

  return null;
}

/**
 * GET /api/email/timezone/countries
 * Get all countries with their timezone configurations
 */
router.get("/timezone/countries", async (req, res) => {
  try {
    const countries = await db.all(`
      SELECT ct.country_code, ct.timezone, ct.name, ct.offset_hours,
             ct.business_start, ct.business_end, ct.weekend_days,
             COUNT(DISTINCT s.id) as site_count
      FROM country_timezones ct
      LEFT JOIN sites s ON LOWER(s.country) = ct.country_code
      GROUP BY ct.country_code
      ORDER BY ct.country_code
    `);

    res.json({
      success: true,
      data: countries,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/timezone/countries/:countryCode
 * Get a specific country's timezone configuration
 */
router.get("/timezone/countries/:countryCode", async (req, res) => {
  try {
    const { countryCode } = req.params;
    const normalizedCode = countryCode.toLowerCase();

    // Get from country_timezones table or use defaults
    const config = await timezoneScheduler.getTimezoneConfig(normalizedCode);

    // Check if there's a custom config in the database
    const customConfig = await db.get(
      "SELECT * FROM country_timezones WHERE country_code = ?",
      [normalizedCode]
    );

    const countryData = {
      country_code: normalizedCode,
      name: config.name,
      timezone: config.timezone,
      business_start: config.businessStart,
      business_end: config.businessEnd,
      weekend_days: config.weekendDays.join(','),
      has_custom_config: !!customConfig
    };

    // Override with custom values if they exist
    if (customConfig) {
      countryData.business_start = customConfig.business_start;
      countryData.business_end = customConfig.business_end;
      countryData.weekend_days = customConfig.weekend_days;
    }

    res.json({
      success: true,
      data: countryData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/email/timezone/countries/:countryCode
 * Update a country's timezone configuration
 */
router.put("/timezone/countries/:countryCode", async (req, res) => {
  try {
    const { countryCode } = req.params;
    const { business_start, business_end, weekend_days } = req.body;

    // Validate inputs
    if (typeof business_start !== 'number' || business_start < 0 || business_start > 23) {
      return res.status(400).json({
        success: false,
        error: "Invalid business_start hour (must be 0-23)"
      });
    }
    if (typeof business_end !== 'number' || business_end < 0 || business_end > 23) {
      return res.status(400).json({
        success: false,
        error: "Invalid business_end hour (must be 0-23)"
      });
    }

    // Parse weekend_days - can be array or comma-separated string
    let weekendDaysArray;
    if (Array.isArray(weekend_days)) {
      weekendDaysArray = weekend_days;
    } else if (typeof weekend_days === 'string') {
      weekendDaysArray = weekend_days.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    } else {
      weekendDaysArray = [0, 6]; // Default to Sunday, Saturday
    }

    const normalizedCode = countryCode.toLowerCase();

    // Check if custom config already exists
    const existing = await db.get(
      "SELECT * FROM country_timezones WHERE country_code = ?",
      [normalizedCode]
    );

    if (existing) {
      // Update existing record
      await db.run(
        `UPDATE country_timezones
         SET business_start = ?, business_end = ?, weekend_days = ?
         WHERE country_code = ?`,
        [business_start, business_end, weekendDaysArray.join(','), normalizedCode]
      );
    } else {
      // Insert new custom config
      const config = await timezoneScheduler.getTimezoneConfig(normalizedCode);

      // Convert offset string like '+5:30' to numeric hours (5.5)
      let offsetHours = 0;
      if (config.offset) {
        const match = config.offset.match(/^([+-]?)(\d+):(\d+)$/);
        if (match) {
          const [, sign, hours, minutes] = match;
          offsetHours = (parseInt(hours) + parseInt(minutes) / 60) * (sign === '-' ? -1 : 1);
        }
      }

      await db.run(
        `INSERT INTO country_timezones (country_code, timezone, name, offset_hours, business_start, business_end, weekend_days)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          normalizedCode,
          config.timezone,
          config.name,
          offsetHours,
          business_start,
          business_end,
          weekendDaysArray.join(',')
        ]
      );
    }

    res.json({
      success: true,
      message: "Country settings updated successfully",
      data: {
        country_code: normalizedCode,
        business_start,
        business_end,
        weekend_days: weekendDaysArray.join(',')
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/timezone/countries-in-business
 * Get countries that are currently in business hours
 */
router.get("/timezone/countries-in-business", (req, res) => {
  try {
    const countriesInBusiness = timezoneScheduler.getCountriesInBusiness();

    res.json({
      success: true,
      data: countriesInBusiness,
      count: countriesInBusiness.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/campaign/timezone-aware
 * Create a campaign with timezone-aware scheduling
 */
router.post("/campaign/timezone-aware", async (req, res) => {
  try {
    const {
      name,
      template_id,
      target_type = "timezone_optimized",
      max_emails_per_batch = 50,
      delay_between_batches = 30,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Campaign name is required",
      });
    }

    // Get all contacts with their country information
    const contacts = await db.all(
      `
      SELECT c.id as contact_id, c.value as email, c.type,
             s.country, s.url as site_url, s.id as site_id
      FROM contacts c
      JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'email'
      AND NOT EXISTS (
        SELECT 1 FROM email_send_log esl
        WHERE esl.contact_id = c.id
        AND esl.template_id = ?
      )
    `,
      [template_id],
    );

    if (contacts.length === 0) {
      return res.json({
        success: true,
        message: "No new contacts to email",
        data: {
          campaign_id: null,
          queued: 0,
          timezone_batches: [],
        },
      });
    }

    // Group contacts by timezone and calculate optimal send times
    const timezoneBatches = {};
    const now = new Date();

    for (const contact of contacts) {
      const countryCode = (contact.country || "in").toLowerCase();
      const tzConfig = await timezoneScheduler.getTimezoneConfig(countryCode);

      // Calculate optimal send time for this contact
      const optimalTime = await timezoneScheduler.calculateOptimalSendTime(
        countryCode,
        now,
      );

      // Create batch key (timezone + date)
      const dateKey = optimalTime.toISOString().split("T")[0];
      const batchKey = `${tzConfig.timezone}_${dateKey}`;

      if (!timezoneBatches[batchKey]) {
        timezoneBatches[batchKey] = {
          timezone: tzConfig.timezone,
          country: countryCode,
          country_name: tzConfig.name,
          send_date: dateKey,
          send_time: optimalTime.toISOString(),
          recipient_local_time: optimalTime.toLocaleString(),
          contacts: [],
        };
      }

      timezoneBatches[batchKey].contacts.push(contact);
    }

    // Create campaign
    const campaignResult = await db.run(
      `
      INSERT INTO email_campaigns (name, template_id, target_type, status, total_recipients)
      VALUES (?, ?, ?, 'queued', ?)
    `,
      [name, template_id, target_type, contacts.length],
    );

    const campaignId = campaignResult.lastInsertId;

    // Queue emails with their scheduled times
    let queuedCount = 0;
    const batches = Object.values(timezoneBatches);

    for (const batch of batches) {
      // Calculate delay for this batch based on send time
      const batchSendTime = new Date(batch.send_time);
      const delayMs = batchSendTime.getTime() - now.getTime();

      // CRITICAL FIX: Check if current time is within business hours for immediate sending
      const now = new Date();
      const isInBusinessHours = await timezoneScheduler.isBusinessHour(now, batch.country);

      let scheduledAt;
      let emailStatus = 'queued';

      if (isInBusinessHours) {
        // During business hours - schedule immediately for sending
        scheduledAt = now;
        console.log(`⏰ Batch for ${batch.country} is in business hours - will send immediately`);
      } else {
        // After business hours - use the calculated optimal time
        scheduledAt = batchSendTime;
        console.log(`📅 Batch for ${batch.country} is outside business hours - scheduled for ${scheduledAt.toISOString()}`);
      }

      // Queue all contacts with proper scheduled time
      for (const contact of batch.contacts) {
        await db.run(
          `
          INSERT INTO email_queue (campaign_id, recipient_email, recipient_name, subject, html_content, text_content, status, country_code, scheduled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            campaignId,
            contact.email,
            "", // recipient_name - can be extracted later
            "Subject placeholder", // subject - will be replaced by template
            "<html>Body placeholder</html>", // html_content
            "Body placeholder", // text_content
            emailStatus,
            batch.country,
            scheduledAt,
          ],
        );
        queuedCount++;
      }
    }

    // Update campaign with actual queued count
    await db.run("UPDATE email_campaigns SET total_recipients = $1 WHERE id = $2", [
      queuedCount,
      campaignId,
    ]);

    res.json({
      success: true,
      message: `Timezone-aware campaign created with ${queuedCount} emails queued. Worker will process them according to business rules.`,
      data: {
        campaign_id: campaignId,
        total_contacts: contacts.length,
        queued: queuedCount,
        timezone_batches: batches.map((b) => ({
          timezone: b.timezone,
          country: b.country,
          country_name: b.country_name,
          send_date: b.send_date,
          send_time: b.send_time,
          recipient_local_time: b.recipient_local_time,
          contact_count: b.contacts.length,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/timezone/optimal-times/:contactId
 * Get optimal send times for a specific contact
 */
router.get("/timezone/optimal-times/:contactId", async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId);

    // Get contact with site information
    const contact = await db.get(
      `
      SELECT c.id, c.value, c.type, c.site_id, s.country, s.url
      FROM contacts c
      JOIN sites s ON c.site_id = s.id
      WHERE c.id = ?
    `,
      [contactId]
    );

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: "Contact not found",
      });
    }

    const countryCode = (contact.country || "in").toLowerCase();
    const tzConfig = await timezoneScheduler.getTimezoneConfig(countryCode);

    // Calculate next 5 optimal send times
    const optimalTimes = [];
    const baseTime = new Date();

    for (let i = 0; i < 5; i++) {
      const nextDay = new Date(baseTime);
      nextDay.setDate(nextDay.getDate() + i);

      const optimalTime = await timezoneScheduler.calculateOptimalSendTime(
        countryCode,
        nextDay,
      );
      optimalTimes.push({
        date: optimalTime.toISOString().split("T")[0],
        time: optimalTime.toISOString(),
        local_time: optimalTime.toLocaleString(),
        timezone: tzConfig.timezone,
        timezone_name: tzConfig.name,
        is_business_hour: timezoneScheduler.isBusinessHour(
          optimalTime,
          countryCode,
        ),
      });
    }

    res.json({
      success: true,
      data: {
        contact: {
          id: contact.id,
          email: contact.value,
          country: contact.country,
          site_url: contact.url,
        },
        timezone: tzConfig,
        optimal_send_times: optimalTimes,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/timezone/monitoring
 * Get comprehensive monitoring data for the dashboard
 * Shows ONLY countries that have emails in the system (fully data-driven)
 */
router.get("/timezone/monitoring", async (req, res) => {
  try {
    const worker = require('./email-queue-worker');

    // Get worker health status
    let healthStatus;
    try {
      healthStatus = worker.getHealthStatus();
    } catch (workerError) {
      healthStatus = {
        isRunning: false,
        isPaused: false,
        activeSenders: 0,
        queuedEmails: 0,
        recentErrors: [],
        lastCheck: new Date().toISOString(),
        parallelMode: true
      };
    }

    const now = new Date();

    // Get ALL email stats by country - includes all statuses, no exclusions
    // Normalize region codes and handle missing data
    let emailStatsByCountry = [];
    try {
      // First, let's see what raw data we have
      const rawData = await db.all(`
        SELECT DISTINCT
          -- Get country code from various sources in priority order:
          -- 1. email_queue.country_code (new field, may be NULL for old emails)
          -- 2. sites.country (from site linked via contact)
          -- 3. Default to NULL which will be filtered out
          eq.country_code as queue_country,
          s.country as site_country,
          eq.id as email_id,
          eq.status,
          eq.scheduled_at,
          eq.created_at
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE eq.id IS NOT NULL
      `);

      // Verify no duplicates in raw data
      const uniqueIds = new Set(rawData.map(r => r.email_id));
      if (uniqueIds.size !== rawData.length) {
        console.warn(`[Monitoring] DUPLICATE DETECTED: ${rawData.length} rows but only ${uniqueIds.size} unique email IDs`);
      }

      console.log(`[Monitoring] Found ${rawData.length} total emails in queue`);

      // Normalize and group by country code
      const countryGroups = new Map();

      for (const row of rawData) {
        // Determine the country code with proper normalization
        let countryCode = null;

        // Try queue_country first (new field)
        if (row.queue_country) {
          countryCode = normalizeCountryCode(row.queue_country);
        }
        // Fall back to site_country
        else if (row.site_country) {
          countryCode = normalizeCountryCode(row.site_country);
        }

        // Skip rows with no valid country code
        if (!countryCode || countryCode === 'unknown') {
          continue;
        }

        // Initialize group if needed
        if (!countryGroups.has(countryCode)) {
          countryGroups.set(countryCode, {
            country_code: countryCode,
            total_count: 0,
            queued_count: 0,
            scheduled_count: 0,
            ready_count: 0,
            sending_count: 0,
            sent_count: 0,
            failed_count: 0,
            waiting_count: 0,
            earliest_scheduled: null
          });
        }

        // Update counts
        const group = countryGroups.get(countryCode);
        group.total_count++;

        // Status-based counts
        if (row.status === 'queued') {
          group.queued_count++;
        } else if (row.status === 'sending') {
          group.sending_count++;
        } else if (row.status === 'sent') {
          group.sent_count++;
        } else if (row.status === 'failed') {
          group.failed_count++;
        }

        // Scheduled vs ready logic
        if (row.status === 'queued') {
          if (row.scheduled_at) {
            const scheduledDate = new Date(row.scheduled_at);
            if (scheduledDate > now) {
              group.scheduled_count++;
              group.waiting_count++;
            } else {
              group.ready_count++;
            }
          } else {
            group.ready_count++;
          }
        }

        // Track earliest scheduled time
        if (row.scheduled_at) {
          if (!group.earliest_scheduled || new Date(row.scheduled_at) < new Date(group.earliest_scheduled)) {
            group.earliest_scheduled = row.scheduled_at;
          }
        }
      }

      // Convert map to array
      emailStatsByCountry = Array.from(countryGroups.values());

      // Debug log: Show detailed breakdown for each country
      console.log(`[Monitoring] Aggregated into ${emailStatsByCountry.length} countries:`);
      emailStatsByCountry.forEach(stat => {
        console.log(`[Monitoring] ${stat.country_code.toUpperCase()}: total=${stat.total_count}, queued=${stat.queued_count}, ready=${stat.ready_count}, waiting=${stat.waiting_count}, sent=${stat.sent_count}, failed=${stat.failed_count}`);
      });

    } catch (dbError) {
      console.error("Error fetching email stats by country:", dbError);
      emailStatsByCountry = [];
    }

    // Build comprehensive country info ONLY for countries that have emails
    // Error isolation: wrap map in try-catch to prevent one failure from breaking entire response
    const countries = await Promise.all(emailStatsByCountry.map(async (stat) => {
      try {
        const code = stat.country_code.toLowerCase();

        // Get timezone config (reads from DB first, falls back to defaults)
        const config = await timezoneScheduler.getTimezoneConfig(code);

        // Get business status (open, weekend, outside_hours)
        const status = await timezoneScheduler.getCountryStatus(now, code);
        const inBusiness = status === 'open';

        // Calculate local time in country's timezone (24-hour format)
        const localTimeString = now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZone: config.timezone
        });
        const localDateString = now.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          weekday: 'short',
          timeZone: config.timezone
        });

        // Calculate next valid business time
        let nextBusinessStart = null;
        let nextBusinessStartDisplay = null;
        let hoursUntilBusiness = null;
        let delayReason = null;

        if (!inBusiness) {
          delayReason = status; // 'weekend' or 'outside_hours'
          try {
            nextBusinessStart = timezoneScheduler.calculateFirstSendTime(code);
            nextBusinessStartDisplay = nextBusinessStart.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
              month: 'short',
              day: 'numeric'
            });
            hoursUntilBusiness = Math.floor((nextBusinessStart - now) / (1000 * 60 * 60));
          } catch (e) {
            // Ignore calculation errors
          }
        }

        // Format business hours for display (24-hour format) with safe error handling
        const formatBusinessHour = (hour) => {
          // Input validation: check if value is defined and not null
          if (hour === undefined || hour === null) {
            console.warn(`[Monitoring] Invalid business hour value: ${hour}, using fallback`);
            return '--:--'; // Safe fallback for undefined/null values
          }

          // Additional validation: check if it's a valid number
          if (typeof hour !== 'number' || isNaN(hour)) {
            console.warn(`[Monitoring] Invalid business hour type: ${typeof hour} (${hour}), using fallback`);
            return '--:--'; // Safe fallback for invalid types
          }

          // Validate hour range (0-23)
          if (hour < 0 || hour > 23) {
            console.warn(`[Monitoring] Business hour out of range: ${hour}, using fallback`);
            return '--:--'; // Safe fallback for out-of-range values
          }

          try {
            return hour.toString().padStart(2, '0') + ':00';
          } catch (error) {
            console.error(`[Monitoring] Error formatting business hour ${hour}:`, error);
            return '--:--'; // Safe fallback if formatting fails
          }
        };

        // Validate config object before accessing business hours
        let businessHoursDisplay = 'Not Configured';
        if (config && config.businessStart !== undefined && config.businessEnd !== undefined) {
          try {
            const startDisplay = formatBusinessHour(config.businessStart);
            const endDisplay = formatBusinessHour(config.businessEnd);
            businessHoursDisplay = `${startDisplay} - ${endDisplay}`;
          } catch (error) {
            console.error(`[Monitoring] Error creating business hours display for country ${code}:`, error);
            businessHoursDisplay = 'Configuration Error';
          }
        } else {
          console.warn(`[Monitoring] Missing business hours config for country ${code}:`, {
            businessStart: config?.businessStart,
            businessEnd: config?.businessEnd
          });
        }

        return {
          country_code: code.toUpperCase(),
          country_code_lower: code,
          timezone: config?.timezone || 'UTC',
          timezone_name: config?.name || 'Unknown Timezone',
          // Business status
          in_business_hours: inBusiness,
          status_reason: status,
          delay_reason: delayReason,
          // Time display
          local_time_display: localTimeString,
          local_date: localDateString,
          // Business hours config
          business_start: config?.businessStart,
          business_end: config?.businessEnd,
          business_hours_display: businessHoursDisplay,
          weekend_days: config?.weekendDays || [0, 6],
          // Next valid send time
          next_business_start: nextBusinessStart ? nextBusinessStart.toISOString() : null,
          next_business_start_display: nextBusinessStartDisplay,
          hours_until_business: hoursUntilBusiness,
          // Email counts (aggregated)
          total: stat.total_count || 0,
          queued: stat.queued_count || 0,
          waiting: stat.waiting_count || 0,
          scheduled: stat.scheduled_count || 0,
          ready: stat.ready_count || 0,
          sending: stat.sending_count || 0,
          sent: stat.sent_count || 0,
          failed: stat.failed_count || 0,
          earliest_scheduled: stat.earliest_scheduled
        };
      } catch (countryError) {
        // Error isolation: log the error but return a safe fallback object
        console.error(`[Monitoring] Error processing country ${stat.country_code}:`, countryError);

        // Return a minimal safe object to prevent API failure
        return {
          country_code: stat.country_code?.toUpperCase() || 'UNKNOWN',
          country_code_lower: stat.country_code?.toLowerCase() || 'unknown',
          timezone: 'UTC',
          timezone_name: 'Error Loading Timezone',
          // Business status
          in_business_hours: false,
          status_reason: 'error',
          delay_reason: 'configuration_error',
          // Time display
          local_time_display: '--:--:--',
          local_date: 'Unknown',
          // Business hours config
          business_start: null,
          business_end: null,
          business_hours_display: 'Configuration Error',
          weekend_days: [0, 6],
          // Next valid send time
          next_business_start: null,
          next_business_start_display: null,
          hours_until_business: null,
          // Email counts (aggregated)
          total: stat.total_count || 0,
          queued: stat.queued_count || 0,
          waiting: 0,
          scheduled: 0,
          ready: stat.ready_count || 0,
          sending: 0,
          sent: stat.sent_count || 0,
          failed: stat.failed_count || 0,
          earliest_scheduled: stat.earliest_scheduled || null
        };
      }
    }));

    // Filter out any null entries from failures
    const filteredCountries = countries.filter(country => country !== null);

    // Sort countries: in-business first, then by ready count descending
    // Error handling: wrap sort in try-catch to prevent comparison errors
    try {
      filteredCountries.sort((a, b) => {
        if (a.in_business_hours && !b.in_business_hours) return -1;
        if (!a.in_business_hours && b.in_business_hours) return 1;
        return (b.ready || 0) - (a.ready || 0); // Safe comparison with fallback
      });
    } catch (sortError) {
      console.error('[Monitoring] Error sorting countries:', sortError);
      // Continue with unsorted array rather than failing
    }

    // Calculate summary stats with error handling
    let summary;
    try {
      summary = {
        total_countries: filteredCountries.length,
        countries_in_business: filteredCountries.filter(c => c.in_business_hours).length,
        total_emails: filteredCountries.reduce((sum, c) => sum + (c.total || 0), 0),
        total_queued: filteredCountries.reduce((sum, c) => sum + (c.queued || 0), 0),
        total_waiting: filteredCountries.reduce((sum, c) => sum + (c.waiting || 0), 0),
        total_scheduled: filteredCountries.reduce((sum, c) => sum + (c.scheduled || 0), 0),
        total_ready: filteredCountries.reduce((sum, c) => sum + (c.ready || 0), 0),
        total_sending: filteredCountries.reduce((sum, c) => sum + (c.sending || 0), 0),
        total_sent: filteredCountries.reduce((sum, c) => sum + (c.sent || 0), 0),
        total_failed: filteredCountries.reduce((sum, c) => sum + (c.failed || 0), 0)
      };
    } catch (summaryError) {
      console.error('[Monitoring] Error calculating summary:', summaryError);
      // Fallback to empty summary if calculation fails
      summary = {
        total_countries: 0,
        countries_in_business: 0,
        total_emails: 0,
        total_queued: 0,
        total_waiting: 0,
        total_scheduled: 0,
        total_ready: 0,
        total_sending: 0,
        total_sent: 0,
        total_failed: 0
      };
    }

    // Get upcoming sends (next hour across all countries) with normalized country codes
    let upcomingEmails = [];
    try {
      const rawUpcoming = await db.all(`
        SELECT
          eq.id,
          eq.recipient_email,
          eq.scheduled_at,
          eq.created_at,
          eq.country_code as queue_country,
          s.country as site_country
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE eq.status = 'queued'
          AND eq.scheduled_at IS NOT NULL
          AND eq.scheduled_at > NOW()
          AND eq.scheduled_at <= NOW() + INTERVAL '1 hour'
        ORDER BY eq.scheduled_at ASC
        LIMIT 20
      `);

      // Normalize country codes
      upcomingEmails = rawUpcoming.map(email => ({
        ...email,
        country_code: normalizeCountryCode(email.queue_country || email.site_country) || 'unknown'
      })).filter(e => e.country_code !== 'unknown');

    } catch (dbError) {
      console.error("Error fetching upcoming emails:", dbError);
      upcomingEmails = [];
    }

    // Get recent sends (last hour) with normalized country codes
    let recentSends = [];
    try {
      const rawRecent = await db.all(`
        SELECT
          eq.id,
          eq.recipient_email,
          eq.sent_at,
          eq.country_code as queue_country,
          s.country as site_country
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE eq.status = 'sent'
          AND eq.sent_at >= NOW() - INTERVAL '1 hour'
        ORDER BY eq.sent_at DESC
        LIMIT 20
      `);

      // Normalize country codes
      recentSends = rawRecent.map(email => ({
        ...email,
        country_code: normalizeCountryCode(email.queue_country || email.site_country) || 'unknown'
      })).filter(e => e.country_code !== 'unknown');

    } catch (dbError) {
      console.error("Error fetching recent sends:", dbError);
      recentSends = [];
    }

    res.json({
      success: true,
      data: {
        worker_status: {
          is_running: healthStatus.isRunning,
          is_paused: healthStatus.isPaused,
          active_senders: healthStatus.activeSenders,
          parallel_mode: healthStatus.parallelMode
        },
        countries: filteredCountries,
        upcoming_sends: upcomingEmails,
        recent_sends: recentSends,
        summary: summary,
        generated_at: now.toISOString()
      }
    });
  } catch (error) {
    // Enhanced error logging with context
    console.error("[Monitoring] Error in timezone monitoring endpoint:", {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Always return a valid response structure to prevent UI crashes
    // Return empty data rather than throwing 500 error
    res.status(200).json({
      success: true, // Return success to prevent UI from breaking
      data: {
        worker_status: {
          is_running: false,
          is_paused: false,
          active_senders: 0,
          parallel_mode: true,
          error: error.message // Include error message for debugging
        },
        countries: [],
        upcoming_sends: [],
        recent_sends: [],
        summary: {
          total_countries: 0,
          countries_in_business: 0,
          total_emails: 0,
          total_queued: 0,
          total_waiting: 0,
          total_scheduled: 0,
          total_ready: 0,
          total_sending: 0,
          total_sent: 0,
          total_failed: 0
        },
        generated_at: new Date().toISOString(),
        error: error.message // Include error for debugging
      }
    });
  }
});

/**
 * GET /api/email/timezone/monitoring/country/:countryCode
 * Get detailed email list for a specific country with filtering
 * Query params:
 * - status: filter by email status (queued, sending, sent, failed, all)
 * - startDate: filter emails created after this date (ISO string)
 * - endDate: filter emails created before this date (ISO string)
 * - search: search in email address or site URL
 * - category: filter by template tag/category
 * - limit: max results (default 100)
 * - offset: pagination offset (default 0)
 */
router.get("/timezone/monitoring/country/:countryCode", async (req, res) => {
  try {
    const { countryCode } = req.params;
    const {
      status = 'all',
      startDate,
      endDate,
      search,
      category,
      limit = 100,
      offset = 0
    } = req.query;

    // Normalize the requested country code
    const normalizedCountryCode = normalizeCountryCode(countryCode);
    if (!normalizedCountryCode) {
      return res.status(400).json({
        success: false,
        error: "Invalid country code"
      });
    }

    const limitNum = Math.min(parseInt(limit) || 100, 500);
    const offsetNum = parseInt(offset) || 0;

    // Debug logging
    console.log(`[Country Drill-Down] Fetching emails for country: ${countryCode} -> normalized: ${normalizedCountryCode}`);
    console.log(`[Country Drill-Down] Filters: status=${status}, category=${category}, search=${search}`);

    // Debug: Check what country codes exist in the database
    try {
      const countryCodesInDb = await db.all(`
        SELECT DISTINCT
          LOWER(TRIM(eq.country_code)) as queue_country,
          LOWER(TRIM(s.country)) as site_country,
          COUNT(*) as count
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        GROUP BY LOWER(TRIM(eq.country_code)), LOWER(TRIM(s.country))
        LIMIT 10
      `);
      console.log('[Country Drill-Down] Country codes in DB:', countryCodesInDb);
    } catch (debugError) {
      console.warn('[Country Drill-Down] Could not debug country codes:', debugError.message);
    }

    // Build query conditions
    const conditions = [];
    const params = [];

    // Country filter - match normalized codes from both sources
    // We need to check if the normalized version of either field matches
    conditions.push("(LOWER(TRIM(eq.country_code)) = ? OR LOWER(TRIM(s.country)) = ?)");
    params.push(normalizedCountryCode, normalizedCountryCode);

    // Status filter
    if (status && status !== 'all') {
      conditions.push("eq.status = ?");
      params.push(status);
    }

    // Date range filter
    if (startDate) {
      conditions.push("eq.created_at >= ?");
      params.push(startDate);
    }
    if (endDate) {
      conditions.push("eq.created_at <= ?");
      params.push(endDate);
    }

    // Search filter (email or site URL)
    if (search) {
      conditions.push("(eq.recipient_email LIKE ? OR s.url LIKE ?)");
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    // Category/tag filter (from email_templates via email_campaigns)
    if (category) {
      conditions.push("et.tags LIKE ?");
      params.push(`%${category}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get paginated email list with full details
    // CRITICAL: Use DISTINCT on eq.id to prevent duplication from joins
    let emails = [];
    try {
      emails = await db.all(`
        SELECT DISTINCT
          eq.id,
          eq.campaign_id,
          eq.recipient_email,
          eq.subject,
          eq.status,
          eq.scheduled_at,
          eq.sent_at,
          eq.created_at,
          eq.error_message,
          eq.attempts,
          eq.tag as email_tag,
          eq.sequence_position,
          eq.country_code as queue_country_code,
          s.url as site_url,
          s.country as site_country,
          s.page_title,
          s.ai_actual_category,
          s.checked_at as site_checked_at,
          ec.name as campaign_name,
          et.name as template_name,
          et.tags as template_tags,
          c.type as contact_type
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        LEFT JOIN email_campaigns ec ON eq.campaign_id = ec.id
        LEFT JOIN email_templates et ON ec.template_id = et.id
        ${whereClause}
        ORDER BY eq.created_at DESC
        LIMIT ? OFFSET ?
      `, [...params, limitNum, offsetNum]);
    } catch (dbError) {
      console.error("Error fetching country emails:", dbError);
      emails = [];
    }

    console.log(`[Country Drill-Down] Query returned ${emails.length} unique emails`);

    // Get total count for pagination
    let totalCount = 0;
    try {
      const countResult = await db.get(`
        SELECT COUNT(DISTINCT eq.id) as count
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        LEFT JOIN email_campaigns ec ON eq.campaign_id = ec.id
        LEFT JOIN email_templates et ON ec.template_id = et.id
        ${whereClause}
      `, params);
      totalCount = countResult?.count || 0;
    } catch (countError) {
      totalCount = emails.length;
    }

    // Enrich emails with delay reason and status info
    const now = new Date();
    const enrichedEmails = emails.map(email => {
      const countryCode = email.queue_country_code || email.site_country || 'unknown';
      let delayReason = null;
      let isWaiting = false;

      if (email.status === 'queued' && email.scheduled_at) {
        const scheduledDate = new Date(email.scheduled_at);
        if (scheduledDate > now) {
          isWaiting = true;
          // Check why it's waiting
          const countryStatus = timezoneScheduler.getCountryStatus(scheduledDate, countryCode);
          delayReason = countryStatus === 'weekend' ? 'weekend' :
                        countryStatus === 'outside_hours' ? 'outside_business_hours' :
                        'scheduled';
        }
      }

      return {
        ...email,
        is_waiting: isWaiting,
        delay_reason: delayReason,
        status_display: email.status === 'queued' ? (isWaiting ? 'waiting' : 'ready') : email.status
      };
    });

    // Get country info for display
    const config = await timezoneScheduler.getTimezoneConfig(normalizedCountryCode);
    const countryStatus = await timezoneScheduler.getCountryStatus(now, normalizedCountryCode);
    const inBusiness = countryStatus === 'open';

    // Calculate aggregated stats for ALL emails (not just current page)
    // This ensures counts match between global monitor and modal
    let stats = {
      total: 0,
      queued: 0,
      waiting: 0,
      ready: 0,
      sending: 0,
      sent: 0,
      failed: 0,
      scheduled: 0
    };

    try {
      // Get ALL email records for this country (without pagination)
      // to calculate accurate stats - use DISTINCT to ensure unique emails
      const allEmails = await db.all(`
        SELECT DISTINCT
          eq.id,
          eq.status,
          eq.scheduled_at,
          eq.country_code as queue_country_code,
          s.country as site_country
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        ${whereClause}
      `, params);

      console.log(`[Country Drill-Down] Calculating stats from ${allEmails.length} unique emails`);

      // Aggregate stats using same logic as global monitor
      for (const email of allEmails) {
        stats.total++;

        // Status-based counts
        if (email.status === 'queued') {
          stats.queued++;
        } else if (email.status === 'sending') {
          stats.sending++;
        } else if (email.status === 'sent') {
          stats.sent++;
        } else if (email.status === 'failed') {
          stats.failed++;
        }

        // Scheduled vs ready logic (same as global monitor)
        if (email.status === 'queued') {
          if (email.scheduled_at) {
            const scheduledDate = new Date(email.scheduled_at);
            if (scheduledDate > now) {
              stats.scheduled++;
              stats.waiting++;
            } else {
              stats.ready++;
            }
          } else {
            stats.ready++;
          }
        }
      }

      console.log(`[Country Drill-Down] Stats: total=${stats.total}, queued=${stats.queued}, ready=${stats.ready}, waiting=${stats.waiting}, sent=${stats.sent}, failed=${stats.failed}`);
    } catch (statsError) {
      console.error('[Country Drill-Down] Error calculating stats:', statsError);
      // Fall back to using totalCount for total
      stats.total = totalCount;
    }

    res.json({
      success: true,
      data: {
        country_code: normalizedCountryCode.toUpperCase(),
        country_info: {
          timezone: config.timezone,
          timezone_name: config.name,
          business_hours: `${config.businessStart}:00 - ${config.businessEnd}:00`,
          weekend_days: config.weekendDays,
          in_business_hours: inBusiness,
          status: countryStatus
        },
        emails: enrichedEmails,
        stats: stats,
        pagination: {
          total: totalCount,
          limit: limitNum,
          offset: offsetNum,
          has_more: (offsetNum + emails.length) < totalCount
        },
        filters_applied: {
          status,
          start_date: startDate,
          end_date: endDate,
          search,
          category
        }
      }
    });
  } catch (error) {
    console.error("Error in country drill-down:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/timezone/monitoring/debug/compare
 * Debug endpoint: Compare counts between global monitor and modal logic
 * Use this to verify consistency between the two aggregation methods
 */
router.get("/timezone/monitoring/debug/compare", async (req, res) => {
  try {
    const now = new Date();
    const normalizeCountryCode = (code) => {
      if (!code) return null;
      let normalized = String(code).trim().toUpperCase();
      const parts = normalized.split(/\s+/);
      for (const part of parts) {
        if (/^[A-Z]{2,3}$/.test(part)) {
          return part.toLowerCase();
        }
      }
      if (normalized.length >= 2) {
        return normalized.substring(0, 2).toLowerCase();
      }
      return null;
    };

    // Method 1: Global monitor aggregation (client-side grouping)
    const rawData = await db.all(`
      SELECT DISTINCT
        eq.country_code as queue_country,
        s.country as site_country,
        eq.id as email_id,
        eq.status,
        eq.scheduled_at,
        eq.created_at
      FROM email_queue eq
      LEFT JOIN contacts c ON eq.contact_id = c.id
      LEFT JOIN sites s ON c.site_id = s.id
      WHERE eq.id IS NOT NULL
    `);

    const globalMonitorStats = new Map();
    for (const row of rawData) {
      let countryCode = null;
      if (row.queue_country) {
        countryCode = normalizeCountryCode(row.queue_country);
      } else if (row.site_country) {
        countryCode = normalizeCountryCode(row.site_country);
      }

      if (!countryCode || countryCode === 'unknown') continue;

      if (!globalMonitorStats.has(countryCode)) {
        globalMonitorStats.set(countryCode, {
          country_code: countryCode,
          total: 0,
          queued: 0,
          ready: 0,
          waiting: 0,
          scheduled: 0,
          sending: 0,
          sent: 0,
          failed: 0
        });
      }

      const group = globalMonitorStats.get(countryCode);
      group.total++;

      if (row.status === 'queued') {
        group.queued++;
        if (row.scheduled_at) {
          const scheduledDate = new Date(row.scheduled_at);
          if (scheduledDate > now) {
            group.scheduled++;
            group.waiting++;
          } else {
            group.ready++;
          }
        } else {
          group.ready++;
        }
      } else if (row.status === 'sending') {
        group.sending++;
      } else if (row.status === 'sent') {
        group.sent++;
      } else if (row.status === 'failed') {
        group.failed++;
      }
    }

    // Method 2: Modal aggregation (per-country query)
    const modalStats = new Map();
    const countries = Array.from(globalMonitorStats.keys());

    for (const countryCode of countries) {
      const allEmails = await db.all(`
        SELECT DISTINCT
          eq.id,
          eq.status,
          eq.scheduled_at,
          eq.country_code as queue_country_code,
          s.country as site_country
        FROM email_queue eq
        LEFT JOIN contacts c ON eq.contact_id = c.id
        LEFT JOIN sites s ON c.site_id = s.id
        WHERE (LOWER(TRIM(eq.country_code)) = ? OR LOWER(TRIM(s.country)) = ?)
      `, [countryCode, countryCode]);

      const stats = {
        country_code: countryCode,
        total: allEmails.length,
        queued: 0,
        ready: 0,
        waiting: 0,
        scheduled: 0,
        sending: 0,
        sent: 0,
        failed: 0
      };

      for (const email of allEmails) {
        if (email.status === 'queued') {
          stats.queued++;
          if (email.scheduled_at) {
            const scheduledDate = new Date(email.scheduled_at);
            if (scheduledDate > now) {
              stats.scheduled++;
              stats.waiting++;
            } else {
              stats.ready++;
            }
          } else {
            stats.ready++;
          }
        } else if (email.status === 'sending') {
          stats.sending++;
        } else if (email.status === 'sent') {
          stats.sent++;
        } else if (email.status === 'failed') {
          stats.failed++;
        }
      }

      modalStats.set(countryCode, stats);
    }

    // Compare results
    const comparison = [];
    const mismatches = [];

    for (const countryCode of countries) {
      const global = globalMonitorStats.get(countryCode);
      const modal = modalStats.get(countryCode);

      const match = global.total === modal.total &&
                    global.queued === modal.queued &&
                    global.ready === modal.ready &&
                    global.waiting === modal.waiting &&
                    global.sent === modal.sent &&
                    global.failed === modal.failed;

      const entry = {
        country_code: countryCode.toUpperCase(),
        match: match,
        global_monitor: global,
        modal_api: modal
      };

      if (!match) {
        mismatches.push({
          country: countryCode.toUpperCase(),
          reason: {
            total: global.total !== modal.total ? `global=${global.total}, modal=${modal.total}` : null,
            queued: global.queued !== modal.queued ? `global=${global.queued}, modal=${modal.queued}` : null,
            ready: global.ready !== modal.ready ? `global=${global.ready}, modal=${modal.ready}` : null,
            waiting: global.waiting !== modal.waiting ? `global=${global.waiting}, modal=${modal.waiting}` : null,
            sent: global.sent !== modal.sent ? `global=${global.sent}, modal=${modal.sent}` : null,
            failed: global.failed !== modal.failed ? `global=${global.failed}, modal=${modal.failed}` : null
          }
        });
      }

      comparison.push(entry);
    }

    res.json({
      success: true,
      data: {
        total_countries: countries.length,
        all_match: mismatches.length === 0,
        mismatches: mismatches,
        comparison: comparison.sort((a, b) => b.country_code.localeCompare(a.country_code))
      }
    });
  } catch (error) {
    console.error("Error in debug comparison:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/email/worker/toggle-parallel
 * Toggle parallel sending mode
 */
router.post("/worker/toggle-parallel", (req, res) => {
  try {
    const { enabled } = req.body;
    const worker = require('./email-queue-worker');

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: "enabled must be a boolean"
      });
    }

    worker.toggleParallelMode(enabled);

    res.json({
      success: true,
      message: `Parallel sending mode ${enabled ? 'enabled' : 'disabled'}`,
      data: { parallelMode: enabled }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/email/timezone/update-country
 * Update business hours settings for a country
 */
router.post("/timezone/update-country", async (req, res) => {
  try {
    const { country_code, business_start, business_end, weekend_days } = req.body;

    if (!country_code) {
      return res.status(400).json({
        success: false,
        error: "country_code is required",
      });
    }

    if (typeof business_start !== 'number' || typeof business_end !== 'number') {
      return res.status(400).json({
        success: false,
        error: "business_start and business_end must be numbers",
      });
    }

    // Check if country exists in database
    const existing = await db.get(
      "SELECT * FROM country_timezones WHERE country_code = ?",
      [country_code.toLowerCase()]
    );

    const weekendDaysStr = Array.isArray(weekend_days)
      ? weekend_days.join(',')
      : (weekend_days || '0,6');

    if (existing) {
      // Update existing record
      await db.run(
        `UPDATE country_timezones
         SET business_start = ?, business_end = ?, weekend_days = ?
         WHERE country_code = ?`,
        [business_start, business_end, weekendDaysStr, country_code.toLowerCase()]
      );
    } else {
      // Get config from timezone-scheduler for new countries
      const timezoneScheduler = require('../timezone-scheduler');
      const defaultConfig = await timezoneScheduler.getTimezoneConfig(country_code) || await timezoneScheduler.getTimezoneConfig('us');

      // Insert new record
      await db.run(
        `INSERT INTO country_timezones (country_code, timezone, name, offset_hours, business_start, business_end, weekend_days)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          country_code.toLowerCase(),
          defaultConfig.timezone,
          defaultConfig.name,
          0, // offset_hours - not critical for this feature
          business_start,
          business_end,
          weekendDaysStr
        ]
      );
    }

    res.json({
      success: true,
      message: `Business hours updated for ${country_code.toUpperCase()}`,
      data: {
        country_code: country_code.toLowerCase(),
        business_start,
        business_end,
        weekend_days: weekendDaysStr
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/email/timezone/stats
 * Get statistics about timezone distribution
 */
router.get("/timezone/stats", async (req, res) => {
  try {
    // Get contact distribution by country/timezone
    const distribution = await db.all(`
      SELECT
        COALESCE(s.country, 'unknown') as country_code,
        COUNT(DISTINCT c.id) as contact_count,
        COUNT(DISTINCT s.id) as site_count
      FROM contacts c
      JOIN sites s ON c.site_id = s.id
      WHERE c.type = 'email'
      GROUP BY COALESCE(s.country, 'unknown')
      ORDER BY contact_count DESC
    `);

    // Get current business status for each country
    const now = new Date();
    const utcHours = now.getUTCHours();

    const countriesWithStatus = await Promise.all(distribution.map(async (item) => {
      const countryCode = item.country_code.toLowerCase();
      const inBusiness = timezoneScheduler.isBusinessHour(now, countryCode);

      // Get timezone config from database for accurate offset_hours
      const tzConfigDb = await db.get(
        `
        SELECT timezone, name, offset_hours, business_start, business_end
        FROM country_timezones
        WHERE country_code = ?
      `,
      [countryCode]
      );

      // Fallback to scheduler config if database doesn't have it
      const tzScheduler = await timezoneScheduler.getTimezoneConfig(countryCode);

      const timezone = tzConfigDb?.timezone || tzScheduler.timezone;
      const timezoneName = tzConfigDb?.name || tzScheduler.name;
      const businessStart = tzConfigDb?.business_start ?? tzScheduler.businessStart;
      const businessEnd = tzConfigDb?.business_end ?? tzScheduler.businessEnd;
      const weekendDays = tzConfigDb?.weekend_days ?? tzScheduler.weekendDays.join(',');

      // Calculate local time properly with fractional offsets (e.g., 5.5 for India)
      const offsetHours =
        tzConfigDb?.offset_hours || parseOffsetString(tzScheduler.offset);
      const offsetMs = offsetHours * 60 * 60 * 1000;
      const localTime = new Date(now.getTime() + offsetMs);

      return {
        ...item,
        in_business_hours: inBusiness,
        timezone: timezone,
        timezone_name: timezoneName,
        local_time: localTime.toISOString(),
        business_start: businessStart,
        business_end: businessEnd,
        weekend_days: weekendDays,
        country_code_lower: countryCode,
      };
    }));

    // Helper function to parse offset strings like '+5:30' or '-5:00' to hours
    function parseOffsetString(offsetStr) {
      if (!offsetStr) return 0;
      const match = offsetStr.match(/^([+-]?)(\d+):(\d+)$/);
      if (!match) return 0;
      const [, sign, hours, minutes] = match;
      const value = parseInt(hours) + parseInt(minutes) / 60;
      return sign === "-" ? -value : value;
    }

    // Calculate optimal send windows
    const inBusinessNow = countriesWithStatus.filter(
      (c) => c.in_business_hours,
    );
    const willBeInBusiness = countriesWithStatus.filter(
      (c) => !c.in_business_hours,
    );

    res.json({
      success: true,
      data: {
        total_countries: distribution.length,
        distribution: countriesWithStatus,
        currently_in_business: {
          count: inBusinessNow.length,
          countries: inBusinessNow,
        },
        outside_business_hours: {
          count: willBeInBusiness.length,
          countries: willBeInBusiness,
        },
        recommended_action:
          inBusinessNow.length > 0
            ? `✅ Ready to send to ${inBusinessNow.length} countries now`
            : ` Wait for optimal send times (${willBeInBusiness.length} countries outside business hours)`,
      },
    });
  } catch (error) {
    console.error("Error in timezone stats:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Helper: Calculate next business window for countries outside business hours
 */
function calculateNextBusinessWindow(countries) {
  const now = new Date();
  let minMinutesUntilOpen = Infinity;

  countries.forEach(country => {
    try {
      if (!country.in_business_hours && country.timezone && country.country_code !== 'unknown') {
        const nextOpen = timezoneScheduler.calculateOptimalSendTime(country.country_code.toLowerCase(), now);
        const minutesUntil = Math.floor((nextOpen - now) / (1000 * 60));
        if (minutesUntil < minMinutesUntilOpen && minutesUntil > 0) {
          minMinutesUntilOpen = minutesUntil;
        }
      }
    } catch (e) {
      // Skip countries that cause errors
    }
  });

  if (minMinutesUntilOpen === Infinity) return 'unknown';
  if (minMinutesUntilOpen < 60) return `${minMinutesUntilOpen} minutes`;
  if (minMinutesUntilOpen < 1440) return `${Math.floor(minMinutesUntilOpen / 60)} hours`;
  return `${Math.floor(minMinutesUntilOpen / 1440)} days`;
}

/**
 * Helper: Get next business hour start time
 */
function getNextBusinessHourStart(countries) {
  const now = new Date();
  let nextOpen = null;

  countries.forEach(country => {
    try {
      if (!country.in_business_hours && country.country_code !== 'unknown') {
        const tzOpen = timezoneScheduler.calculateOptimalSendTime(country.country_code.toLowerCase(), now);
        if (!nextOpen || tzOpen < nextOpen) {
          nextOpen = tzOpen;
        }
      }
    } catch (e) {
      // Skip countries that cause errors
    }
  });

  return nextOpen ? nextOpen.toISOString() : null;
}

module.exports = router;
