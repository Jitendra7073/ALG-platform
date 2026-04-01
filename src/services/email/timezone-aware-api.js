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
 * GET /api/email/timezone/countries
 * Get all countries with their timezone configurations
 */
router.get("/timezone/countries", (req, res) => {
  try {
    const countries = db.all(`
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
router.post("/campaign/timezone-aware", (req, res) => {
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
    const contacts = db.all(
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

    contacts.forEach((contact) => {
      const countryCode = (contact.country || "in").toLowerCase();
      const tzConfig = timezoneScheduler.getTimezoneConfig(countryCode);

      // Calculate optimal send time for this contact
      const optimalTime = timezoneScheduler.calculateOptimalSendTime(
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
    });

    // Create campaign
    const campaignResult = db.run(
      `
      INSERT INTO email_campaigns (name, template_id, target_type, status, total_recipients)
      VALUES (?, ?, ?, 'queued', ?)
    `,
      [name, template_id, target_type, contacts.length],
    );

    const campaignId = campaignResult.lastInsertRowid;

    // Queue emails with their scheduled times
    let queuedCount = 0;
    const batches = Object.values(timezoneBatches);

    batches.forEach((batch) => {
      // Calculate delay for this batch based on send time
      const batchSendTime = new Date(batch.send_time);
      const delayMs = batchSendTime.getTime() - now.getTime();

      // Only queue if send time is in the future
      if (delayMs > 0) {
        batch.contacts.forEach((contact) => {
          db.run(
            `
            INSERT INTO email_queue (campaign_id, recipient_email, recipient_name, subject, html_content, text_content, status, scheduled_at)
            VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
          `,
            [
              campaignId,
              contact.email,
              "", // recipient_name - can be extracted later
              "Subject placeholder", // subject - will be replaced by template
              "<html>Body placeholder</html>", // html_content
              "Body placeholder", // text_content
              batch.send_time,
            ],
          );
          queuedCount++;
        });
      }
    });

    // Update campaign with actual queued count
    db.run("UPDATE email_campaigns SET total_recipients = ? WHERE id = ?", [
      queuedCount,
      campaignId,
    ]);

    res.json({
      success: true,
      message: `Timezone-aware campaign created with ${queuedCount} emails queued`,
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
router.get("/timezone/optimal-times/:contactId", (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId);

    // Get contact with site information
    const contact = db
      .prepare(
        `
      SELECT c.id, c.value, c.type, c.site_id, s.country, s.url
      FROM contacts c
      JOIN sites s ON c.site_id = s.id
      WHERE c.id = ?
    `,
      )
      .get(contactId);

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: "Contact not found",
      });
    }

    const countryCode = (contact.country || "in").toLowerCase();
    const tzConfig = timezoneScheduler.getTimezoneConfig(countryCode);

    // Calculate next 5 optimal send times
    const optimalTimes = [];
    const baseTime = new Date();

    for (let i = 0; i < 5; i++) {
      const nextDay = new Date(baseTime);
      nextDay.setDate(nextDay.getDate() + i);

      const optimalTime = timezoneScheduler.calculateOptimalSendTime(
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
 * GET /api/email/timezone/stats
 * Get statistics about timezone distribution
 */
router.get("/timezone/stats", (req, res) => {
  try {
    // Get contact distribution by country/timezone
    const distribution = db.all(`
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

    const countriesWithStatus = distribution.map((item) => {
      const countryCode = item.country_code.toLowerCase();
      const inBusiness = timezoneScheduler.isBusinessHour(now, countryCode);

      // Get timezone config from database for accurate offset_hours
      const tzConfigDb = db
        .prepare(
          `
        SELECT timezone, name, offset_hours, business_start, business_end
        FROM country_timezones
        WHERE country_code = ?
      `,
        )
        .get(countryCode);

      // Fallback to scheduler config if database doesn't have it
      const tzScheduler = timezoneScheduler.getTimezoneConfig(countryCode);

      const timezone = tzConfigDb?.timezone || tzScheduler.timezone;
      const timezoneName = tzConfigDb?.name || tzScheduler.name;

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
      };
    });

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

module.exports = router;
