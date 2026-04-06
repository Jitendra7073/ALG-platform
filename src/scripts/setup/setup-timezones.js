/**
 * Setup country_timezones table
 * Creates the table and populates it with timezone data for common countries
 *
 * Usage: node src/scripts/setup/setup-timezones.js
 */

const Database = require("better-sqlite3");
const path = require("path");

// Database file location (in project root)
const DB_PATH = path.join(__dirname, "../../../wordpress-detector.db");

console.log("Setting up country_timezones table...\n");

// Get the raw database instance for transaction support
const db = new Database(DB_PATH);

// Create the table
db.exec(`
  CREATE TABLE IF NOT EXISTS country_timezones (
    country_code TEXT PRIMARY KEY,
    timezone TEXT NOT NULL,
    name TEXT NOT NULL,
    offset_hours REAL NOT NULL,
    business_start INTEGER DEFAULT 9,
    business_end INTEGER DEFAULT 17,
    weekend_days TEXT DEFAULT '6,0'
  )
`);

console.log("✅ Table created successfully");

// Insert timezone data for common countries
const timezoneData = [
  { code: "in", timezone: "Asia/Kolkata", name: "India", offset: 5.5, businessStart: 9, businessEnd: 18, weekends: "6,0" },
  { code: "us", timezone: "America/New_York", name: "United States", offset: -5, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "uk", timezone: "Europe/London", name: "United Kingdom", offset: 0, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "ca", timezone: "America/Toronto", name: "Canada", offset: -5, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "au", timezone: "Australia/Sydney", name: "Australia", offset: 10, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "de", timezone: "Europe/Berlin", name: "Germany", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "fr", timezone: "Europe/Paris", name: "France", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "ae", timezone: "Asia/Dubai", name: "United Arab Emirates", offset: 4, businessStart: 9, businessEnd: 17, weekends: "5,6" },
  { code: "sg", timezone: "Asia/Singapore", name: "Singapore", offset: 8, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "jp", timezone: "Asia/Tokyo", name: "Japan", offset: 9, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "br", timezone: "America/Sao_Paulo", name: "Brazil", offset: -3, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "za", timezone: "Africa/Johannesburg", name: "South Africa", offset: 2, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "cn", timezone: "Asia/Shanghai", name: "China", offset: 8, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "it", timezone: "Europe/Rome", name: "Italy", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "es", timezone: "Europe/Madrid", name: "Spain", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "nl", timezone: "Europe/Amsterdam", name: "Netherlands", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "se", timezone: "Europe/Stockholm", name: "Sweden", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "no", timezone: "Europe/Oslo", name: "Norway", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "dk", timezone: "Europe/Copenhagen", name: "Denmark", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "fi", timezone: "Europe/Helsinki", name: "Finland", offset: 2, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "ch", timezone: "Europe/Zurich", name: "Switzerland", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "at", timezone: "Europe/Vienna", name: "Austria", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "be", timezone: "Europe/Brussels", name: "Belgium", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "pl", timezone: "Europe/Warsaw", name: "Poland", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "cz", timezone: "Europe/Prague", name: "Czech Republic", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "gr", timezone: "Europe/Athens", name: "Greece", offset: 2, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "pt", timezone: "Europe/Lisbon", name: "Portugal", offset: 0, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "ru", timezone: "Europe/Moscow", name: "Russia", offset: 3, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "mx", timezone: "America/Mexico_City", name: "Mexico", offset: -6, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "ar", timezone: "America/Argentina/Buenos_Aires", name: "Argentina", offset: -3, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "co", timezone: "America/Bogota", name: "Colombia", offset: -5, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "cl", timezone: "America/Santiago", name: "Chile", offset: -4, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "pe", timezone: "America/Lima", name: "Peru", offset: -5, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "kr", timezone: "Asia/Seoul", name: "South Korea", offset: 9, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "tw", timezone: "Asia/Taipei", name: "Taiwan", offset: 8, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "th", timezone: "Asia/Bangkok", name: "Thailand", offset: 7, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "my", timezone: "Asia/Kuala_Lumpur", name: "Malaysia", offset: 8, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "id", timezone: "Asia/Jakarta", name: "Indonesia", offset: 7, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "ph", timezone: "Asia/Manila", name: "Philippines", offset: 8, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "vn", timezone: "Asia/Ho_Chi_Minh", name: "Vietnam", offset: 7, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "hk", timezone: "Asia/Hong_Kong", name: "Hong Kong", offset: 8, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "nz", timezone: "Pacific/Auckland", name: "New Zealand", offset: 12, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "ie", timezone: "Europe/Dublin", name: "Ireland", offset: 0, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "il", timezone: "Asia/Jerusalem", name: "Israel", offset: 2, businessStart: 9, businessEnd: 17, weekends: "5,6" },
  { code: "sa", timezone: "Asia/Riyadh", name: "Saudi Arabia", offset: 3, businessStart: 9, businessEnd: 17, weekends: "5,6" },
  { code: "qa", timezone: "Asia/Qatar", name: "Qatar", offset: 3, businessStart: 9, businessEnd: 17, weekends: "5,6" },
  { code: "kw", timezone: "Asia/Kuwait", name: "Kuwait", offset: 3, businessStart: 9, businessEnd: 17, weekends: "5,6" },
  { code: "tr", timezone: "Europe/Istanbul", name: "Turkey", offset: 3, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "eg", timezone: "Africa/Cairo", name: "Egypt", offset: 2, businessStart: 9, businessEnd: 17, weekends: "5,6" },
  { code: "ng", timezone: "Africa/Lagos", name: "Nigeria", offset: 1, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "ke", timezone: "Africa/Nairobi", name: "Kenya", offset: 3, businessStart: 9, businessEnd: 17, weekends: "6,0" },
  { code: "unknown", timezone: "UTC", name: "Unknown/Other", offset: 0, businessStart: 9, businessEnd: 17, weekends: "6,0" },
];

// Insert data using prepared statement for better performance
const insert = db.prepare(`
  INSERT OR REPLACE INTO country_timezones
  (country_code, timezone, name, offset_hours, business_start, business_end, weekend_days)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction((countries) => {
  for (const country of countries) {
    insert.run(
      country.code,
      country.timezone,
      country.name,
      country.offset,
      country.businessStart,
      country.businessEnd,
      country.weekends
    );
  }
});

insertMany(timezoneData);

console.log(`✅ Inserted ${timezoneData.length} countries with timezone data`);
console.log("\n📊 Sample data:");
const sample = db.prepare(`
  SELECT country_code, name, timezone, offset_hours
  FROM country_timezones
  LIMIT 5
`).all();
sample.forEach((row) => {
  console.log(`   ${row.country_code.toUpperCase()}: ${row.name} (${row.timezone}, UTC${row.offset_hours >= 0 ? '+' : ''}${row.offset_hours})`);
});

console.log("\n✅ Setup complete!");
console.log("\n💡 Usage:");
console.log("   - Query: SELECT * FROM country_timezones WHERE country_code = 'in'");
console.log("   - API: GET /api/email/timezone/countries");
console.log("   - Stats: GET /api/email/timezone/stats\n");

// Close database connection
db.close();
