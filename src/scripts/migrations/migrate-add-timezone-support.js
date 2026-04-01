/**
 * Migration: Add Timezone Support for Smart Email Scheduling
 *
 * This migration adds:
 * 1. Timezone mapping table
 * 2. Optimal send time tracking to sites table
 * 3. Email send preferences table
 */

const db = require("../../database/database.js");

console.log(" Starting Timezone Support Migration...");

try {
  // 1. Create country_timezones table
  console.log("1. Creating country_timezones table...");
  db.run(`
    CREATE TABLE IF NOT EXISTS country_timezones (
      country_code TEXT PRIMARY KEY,
      timezone TEXT NOT NULL,
      name TEXT,
      offset_hours REAL,
      business_start INTEGER DEFAULT 9,
      business_end INTEGER DEFAULT 17,
      weekend_days TEXT DEFAULT '0,6',
      preferred_send_times TEXT DEFAULT '["09:00","10:00","14:00","15:00"]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Add timezone columns to sites table
  console.log("2. Adding timezone columns to sites table...");
  try {
    db.run(`ALTER TABLE sites ADD COLUMN timezone TEXT`);
    console.log("   ✅ Added sites.timezone");
  } catch (e) {
    console.log("   ⏭️  sites.timezone already exists");
  }

  try {
    db.run(`ALTER TABLE sites ADD COLUMN optimal_send_time TEXT`);
    console.log("   ✅ Added sites.optimal_send_time");
  } catch (e) {
    console.log("   ⏭️  sites.optimal_send_time already exists");
  }

  // 3. Create email_send_preferences table
  console.log("3. Creating email_send_preferences table...");
  db.run(`
    CREATE TABLE IF NOT EXISTS email_send_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country_code TEXT,
      timezone TEXT,
      enabled INTEGER DEFAULT 1,
      send_window_start INTEGER DEFAULT 9,
      send_window_end INTEGER DEFAULT 17,
      avoid_weekends INTEGER DEFAULT 1,
      max_emails_per_hour INTEGER DEFAULT 10,
      cooldown_minutes INTEGER DEFAULT 30,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. Create email_send_log_enhanced table (to track timezone performance)
  console.log("4. Creating email_send_log_enhanced table...");
  db.run(`
    CREATE TABLE IF NOT EXISTS email_send_log_enhanced (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER,
      contact_email TEXT,
      country_code TEXT,
      timezone TEXT,
      scheduled_time TEXT,
      sent_time TEXT,
      recipient_local_hour INTEGER,
      was_business_hours INTEGER,
      day_of_week INTEGER,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 5. Seed timezone data for common countries
  console.log("5. Seeding timezone data...");
  const timezoneData = [
    {
      country: "in",
      timezone: "Asia/Kolkata",
      name: "India Standard Time",
      offset: 5.5,
      start: 9,
      end: 17,
      weekends: "0,6",
    },
    {
      country: "us",
      timezone: "America/New_York",
      name: "Eastern Standard Time",
      offset: -5,
      start: 9,
      end: 17,
      weekends: "0,6",
    },
    {
      country: "uk",
      timezone: "Europe/London",
      name: "Greenwich Mean Time",
      offset: 0,
      start: 9,
      end: 17,
      weekends: "0,6",
    },
    {
      country: "ca",
      timezone: "America/Toronto",
      name: "Eastern Standard Time",
      offset: -5,
      start: 9,
      end: 17,
      weekends: "0,6",
    },
    {
      country: "au",
      timezone: "Australia/Sydney",
      name: "Australian Eastern Time",
      offset: 10,
      start: 9,
      end: 17,
      weekends: "0,6",
    },
    {
      country: "de",
      timezone: "Europe/Berlin",
      name: "Central European Time",
      offset: 1,
      start: 9,
      end: 17,
      weekends: "0,6",
    },
    {
      country: "fr",
      timezone: "Europe/Paris",
      name: "Central European Time",
      offset: 1,
      start: 9,
      end: 17,
      weekends: "0,6",
    },
    {
      country: "jp",
      timezone: "Asia/Tokyo",
      name: "Japan Standard Time",
      offset: 9,
      start: 9,
      end: 17,
      weekends: "0,6",
    },
    {
      country: "sg",
      timezone: "Asia/Singapore",
      name: "Singapore Time",
      offset: 8,
      start: 9,
      end: 18,
      weekends: "0,6",
    },
    {
      country: "ae",
      timezone: "Asia/Dubai",
      name: "Gulf Standard Time",
      offset: 4,
      start: 9,
      end: 17,
      weekends: "5,6",
    },
  ];

  const insertTimezone = db.prepare(`
    INSERT OR REPLACE INTO country_timezones
    (country_code, timezone, name, offset_hours, business_start, business_end, weekend_days)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  timezoneData.forEach((tz) => {
    insertTimezone.run(
      tz.country,
      tz.timezone,
      tz.name,
      tz.offset,
      tz.start,
      tz.end,
      tz.weekends,
    );
  });

  console.log(`   ✅ Seeded ${timezoneData.length} countries`);

  // 6. Update existing sites with timezone information
  console.log("6. Updating existing sites with timezone information...");
  const updateResult = db.run(`
    UPDATE sites
    SET timezone = (
      SELECT timezone FROM country_timezones
      WHERE country_timezones.country_code = LOWER(sites.country)
    )
    WHERE sites.timezone IS NULL
  `);

  console.log(`   ✅ Updated ${updateResult.changes} sites with timezone data`);

  // 7. Seed default email preferences
  console.log("7. Seeding default email send preferences...");
  const prefInsert = db.prepare(`
    INSERT OR IGNORE INTO email_send_preferences
    (country_code, timezone, enabled, send_window_start, send_window_end, avoid_weekends, max_emails_per_hour, cooldown_minutes)
    VALUES (?, ?, 1, ?, ?, 1, ?, ?)
  `);

  const preferences = [
    { country: "in", start: 9, end: 17, max: 15, cooldown: 20 },
    { country: "us", start: 9, end: 17, max: 10, cooldown: 30 },
    { country: "uk", start: 9, end: 17, max: 10, cooldown: 30 },
    { country: "ca", start: 9, end: 17, max: 10, cooldown: 30 },
    { country: "au", start: 9, end: 17, max: 8, cooldown: 45 },
    { country: "de", start: 9, end: 17, max: 8, cooldown: 30 },
    { country: "fr", start: 9, end: 17, max: 8, cooldown: 30 },
    { country: "jp", start: 9, end: 17, max: 5, cooldown: 60 },
    { country: "sg", start: 9, end: 18, max: 12, cooldown: 30 },
    { country: "ae", start: 9, end: 17, max: 5, cooldown: 60 },
  ];

  preferences.forEach((pref) => {
    const timezone = db
      .prepare("SELECT timezone FROM country_timezones WHERE country_code = ?")
      .get(pref.country);
    if (timezone) {
      prefInsert.run(
        pref.country,
        timezone.timezone,
        pref.start,
        pref.end,
        pref.max,
        pref.cooldown,
      );
    }
  });

  console.log(`   ✅ Seeded ${preferences.length} email send preferences`);

  console.log("\n✅ Timezone Support Migration Complete!");
  console.log("\n📊 Summary:");
  console.log("   - country_timezones table created");
  console.log("   - sites table enhanced with timezone columns");
  console.log("   - email_send_preferences table created");
  console.log("   - email_send_log_enhanced table created");
  console.log("   - Timezone data seeded for 10 countries");
  console.log("   - Email send preferences configured");
} catch (error) {
  console.error("❌ Migration failed:", error);
  process.exit(1);
}
