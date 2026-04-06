/**
 * Timezone-Aware Email Scheduler
 * Calculates optimal send times based on recipient's timezone and business hours
 */

const countryTimezones = {
  'in': {
    timezone: 'Asia/Kolkata',
    name: 'India Standard Time',
    offset: '+5:30',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6], // Sunday, Saturday
    preferredTimes: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00']
  },
  'us': {
    timezone: 'America/New_York',
    name: 'Eastern Standard Time',
    offset: '-5:00',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6], // Sunday, Saturday
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  'uk': {
    timezone: 'Europe/London',
    name: 'Greenwich Mean Time',
    offset: '+0:00',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    preferredTimes: ['09:30', '10:00', '14:00', '15:00', '16:00']
  },
  'ca': {
    timezone: 'America/Toronto',
    name: 'Eastern Standard Time',
    offset: '-5:00',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  'au': {
    timezone: 'Australia/Sydney',
    name: 'Australian Eastern Time',
    offset: '+10:00',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  'de': {
    timezone: 'Europe/Berlin',
    name: 'Central European Time',
    offset: '+1:00',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  'fr': {
    timezone: 'Europe/Paris',
    name: 'Central European Time',
    offset: '+1:00',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  'jp': {
    timezone: 'Asia/Tokyo',
    name: 'Japan Standard Time',
    offset: '+9:00',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  'sg': {
    timezone: 'Asia/Singapore',
    name: 'Singapore Time',
    offset: '+8:00',
    businessStart: 9,
    businessEnd: 18,
    weekendDays: [0, 6],
    preferredTimes: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00']
  },
  'ae': {
    timezone: 'Asia/Dubai',
    name: 'Gulf Standard Time',
    offset: '+4:00',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [5, 6], // Friday, Saturday
    preferredTimes: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00']
  }
};

/**
 * Get timezone configuration for a country
 * Checks database first for custom settings, falls back to defaults
 * NOTE: This function is now async to support PostgreSQL
 */
async function getTimezoneConfig(countryCode) {
  const code = countryCode.toLowerCase();
  const defaultConfig = countryTimezones[code] || countryTimezones['us'];

  // Try to get custom settings from database
  try {
    const { initDatabase } = require('../../database/database.js');
    const db = initDatabase();
    const customConfig = await db.get(
      'SELECT * FROM country_timezones WHERE country_code = ?',
      [code]
    );

    if (customConfig) {
      // Merge custom settings with default config
      return {
        ...defaultConfig,
        businessStart: customConfig.business_start,
        businessEnd: customConfig.business_end,
        weekendDays: customConfig.weekend_days
          ? customConfig.weekend_days.split(',').map(Number)
          : defaultConfig.weekendDays
      };
    }
  } catch (error) {
    // If database query fails, use default config
    console.debug('Could not fetch custom timezone config from database:', error.message);
  }

  return defaultConfig;
}

/**
 * Check if a given time is during business hours in a specific timezone
 */
async function isBusinessHour(date, countryCode) {
  const config = await getTimezoneConfig(countryCode);

  // Get hour in the recipient's timezone using Intl API with formatToParts
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: 'numeric',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const hourPart = parts.find(p => p.type === 'hour');
  const hour = hourPart ? parseInt(hourPart.value) : 0;

  // Get day of week by formatting the date in the target timezone
  // and parsing it to get the day
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    weekday: 'long'
  });
  const dayString = dayFormatter.format(date).toLowerCase();

  // Map day names to numbers (0 = Sunday, 1 = Monday, etc.)
  const dayMap = {
    'sunday': 0,
    'monday': 1,
    'tuesday': 2,
    'wednesday': 3,
    'thursday': 4,
    'friday': 5,
    'saturday': 6
  };
  const day = dayMap[dayString];

  // Check if it's a weekend
  if (config.weekendDays.includes(day)) {
    return false;
  }

  // Check if it's within business hours
  return hour >= config.businessStart && hour < config.businessEnd;
}

/**
 * Calculate the next optimal send time for a recipient
 */
async function calculateOptimalSendTime(countryCode, baseTime = new Date()) {
  const config = await getTimezoneConfig(countryCode);

  // Start from the next hour to avoid past times
  let checkDate = new Date(baseTime.getTime() + 60 * 60 * 1000); // At least 1 hour from now

  // Try to find the next optimal time within the next 7 days
  const maxDays = 7;
  const maxAttempts = maxDays * 24; // Check each hour for 7 days
  const hourIncrement = 60 * 60 * 1000; // 1 hour

  for (let i = 0; i < maxAttempts; i++) {
    const testDate = new Date(checkDate.getTime() + i * hourIncrement);

    if (await isBusinessHour(testDate, countryCode)) {
      // This is a business hour - check if it's a preferred time
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: config.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });

      const timeString = formatter.format(testDate);
      let [hours, minutes] = timeString.split(':').map(Number);
      // Handle midnight (24:xx should be 0:xx)
      if (hours === 24) hours = 0;

      // Check if this is one of the preferred times (or close to it)
      const isPreferredTime = config.preferredTimes.some(preferred => {
        const [prefHour, prefMin] = preferred.split(':').map(Number);
        // Allow within 30 minutes of preferred time
        return hours === prefHour && Math.abs(minutes - prefMin) <= 30;
      });

      if (isPreferredTime) {
        return testDate;
      }
    }
  }

  // Fallback: return next business day morning (approximately)
  let fallbackDate = new Date(baseTime);
  fallbackDate.setDate(fallbackDate.getDate() + 1);

  // Find the first business hour on the next day
  for (let hour = 0; hour < 24; hour++) {
    const testDate = new Date(fallbackDate);
    testDate.setHours(hour, 0, 0, 0);

    if (isBusinessHour(testDate, countryCode)) {
      return testDate;
    }
  }

  // Ultimate fallback: return 1 day from now at business start time
  fallbackDate = new Date(baseTime.getTime() + 24 * 60 * 60 * 1000);
  fallbackDate.setHours(config.businessStart, 0, 0, 0);
  return fallbackDate;
}

/**
 * Convert a date to a specific timezone using Intl API
 */
function convertToTimezone(date, timezone) {
  // Use Intl API to get the proper local time for the timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });

  // Format the date in the target timezone and parse it back
  const parts = formatter.formatToParts(date);
  const partValues = {};
  parts.forEach(part => {
    partValues[part.type] = part.value;
  });

  // Create a new Date object with the timezone-adjusted values
  const localDate = new Date(
    partValues.year,
    partValues.month - 1,
    partValues.day,
    partValues.hour,
    partValues.minute,
    partValues.second || 0
  );

  return localDate;
}

/**
 * Get all countries that are currently in business hours
 */
function getCountriesInBusiness() {
  const now = new Date();
  const countriesInBusiness = [];

  for (const [code, config] of Object.entries(countryTimezones)) {
    if (isBusinessHour(now, code)) {
      // Get the local time string for display
      const timeString = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: config.timezone
      });

      // For sorting, get UTC offset in hours
      const offsetString = now.toLocaleString('en-US', {
        timeZone: config.timezone,
        timeZoneName: 'shortOffset'
      });
      // Extract offset (e.g., "GMT+5:30" -> 5.5)
      const offsetMatch = offsetString.match(/GMT([+-])(\d+):?(\d+)?/);
      let offsetHours = 0;
      if (offsetMatch) {
        const sign = offsetMatch[1] === '-' ? -1 : 1;
        offsetHours = sign * (parseInt(offsetMatch[2]) + (offsetMatch[3] ? parseInt(offsetMatch[3]) / 60 : 0));
      }

      countriesInBusiness.push({
        country: code,
        name: config.name,
        timezone: config.timezone,
        currentLocalTime: timeString,
        offsetHours: offsetHours
      });
    }
  }

  return countriesInBusiness.sort((a, b) => a.offsetHours - b.offsetHours);
}

/**
 * Get the status reason for a country (why it's not in business hours)
 * Returns: 'weekend' | 'outside_hours' | 'open'
 */
async function getCountryStatus(date, countryCode) {
  const config = await getTimezoneConfig(countryCode);

  // Get hour in the recipient's timezone using Intl API with formatToParts
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: 'numeric',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const hourPart = parts.find(p => p.type === 'hour');
  const hour = hourPart ? parseInt(hourPart.value) : 0;

  // Get day of week by formatting the date in the target timezone
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    weekday: 'long'
  });
  const dayString = dayFormatter.format(date).toLowerCase();

  // Map day names to numbers (0 = Sunday, 1 = Monday, etc.)
  const dayMap = {
    'sunday': 0,
    'monday': 1,
    'tuesday': 2,
    'wednesday': 3,
    'thursday': 4,
    'friday': 5,
    'saturday': 6
  };
  const day = dayMap[dayString];

  // Check if it's a weekend
  if (config.weekendDays.includes(day)) {
    return 'weekend';
  }

  // Check if it's within business hours
  if (hour >= config.businessStart && hour < config.businessEnd) {
    return 'open';
  }

  return 'outside_hours';
}

/**
 * Batch schedule emails by timezone groups
 */
async function batchScheduleEmailsByTimezone(emails) {
  const timezoneBatches = {};

  for (const email of emails) {
    const countryCode = email.country || 'us';
    const config = await getTimezoneConfig(countryCode);
    const optimalTime = await calculateOptimalSendTime(countryCode);

    // Group by date (to batch emails for same timezone/date)
    const dateKey = optimalTime.toISOString().split('T')[0];
    const batchKey = `${config.timezone}_${dateKey}`;

    if (!timezoneBatches[batchKey]) {
      timezoneBatches[batchKey] = {
        timezone: config.timezone,
        country: countryCode,
        sendDate: dateKey,
        emails: []
      };
    }

    timezoneBatches[batchKey].emails.push({
      ...email,
      scheduled_at: optimalTime.toISOString()
    });
  }

  return Object.values(timezoneBatches);
}

/**
 * Get smart send time for a contact (traces back to site country)
 */
function getSmartSendTimeForContact(contactId, db) {
  // Get contact with site information
  const contact = db.prepare(`
    SELECT c.id, c.value, c.site_id, s.country, s.url
    FROM contacts c
    JOIN sites s ON c.site_id = s.id
    WHERE c.id = ?
  `).get(contactId);

  if (!contact) {
    // Fallback to default time
    return new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  }

  const countryCode = contact.country || 'in';
  return calculateOptimalSendTime(countryCode);
}

/**
 * Adjust a date to fall within business hours
 * If the date is outside business hours, moves it to the next valid business hour
 */
async function adjustToBusinessHours(date, countryCode) {
  try {
    const config = await getTimezoneConfig(countryCode);

    // Validate input date
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      console.warn('Invalid date input to adjustToBusinessHours, using current time');
      date = new Date();
    }

    let adjustedDate = new Date(date.getTime());

    // Check if we're outside business hours in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'long'
    });

    const parts = formatter.formatToParts(adjustedDate);
    const hourPart = parts.find(p => p.type === 'hour');
    const dayPart = parts.find(p => p.type === 'weekday');
    const hour = hourPart ? parseInt(hourPart.value) : 0;
    const dayName = dayPart ? dayPart.value.toLowerCase() : '';

    const dayMap = {
      'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
      'thursday': 4, 'friday': 5, 'saturday': 6
    };
    const day = dayMap[dayName];

    // If it's a weekend, move to next business day morning
    if (config.weekendDays.includes(day)) {
      // Find the next non-weekend day
      while (true) {
        adjustedDate.setDate(adjustedDate.getDate() + 1);
        const newParts = formatter.formatToParts(adjustedDate);
        const newDayPart = newParts.find(p => p.type === 'weekday');
        const newDayName = newDayPart ? newDayPart.value.toLowerCase() : '';
        const newDay = dayMap[newDayName];

        if (!config.weekendDays.includes(newDay)) {
          // Set to business start time
          adjustedDate.setHours(config.businessStart, 0, 0, 0);
          break;
        }
      }
    } else if (hour < config.businessStart) {
      // Before business hours - move to start time today
      adjustedDate.setHours(config.businessStart, 0, 0, 0);
    } else if (hour >= config.businessEnd) {
      // After business hours - move to start time tomorrow
      adjustedDate.setDate(adjustedDate.getDate() + 1);
      adjustedDate.setHours(config.businessStart, 0, 0, 0);

      // Check if tomorrow is a weekend
      const tomorrowParts = formatter.formatToParts(adjustedDate);
      const tomorrowDayPart = tomorrowParts.find(p => p.type === 'weekday');
      const tomorrowDayName = tomorrowDayPart ? tomorrowDayPart.value.toLowerCase() : '';
      const tomorrowDay = dayMap[tomorrowDayName];

      if (config.weekendDays.includes(tomorrowDay)) {
        // Skip to Monday (or next business day)
        while (config.weekendDays.includes(tomorrowDay)) {
          adjustedDate.setDate(adjustedDate.getDate() + 1);
          const checkParts = formatter.formatToParts(adjustedDate);
          const checkDayPart = checkParts.find(p => p.type === 'weekday');
          const checkDayName = checkDayPart ? checkDayPart.value.toLowerCase() : '';
          const checkDay = dayMap[checkDayName];
          if (!config.weekendDays.includes(checkDay)) break;
        }
      }
    }

    // Validate the result before returning
    if (isNaN(adjustedDate.getTime()) || !(adjustedDate instanceof Date)) {
      console.error('adjustToBusinessHours produced invalid date, returning fallback');
      return new Date(Date.now() + (60 * 60 * 1000)); // 1 hour from now
    }

    return adjustedDate;
  } catch (error) {
    console.error('Error in adjustToBusinessHours:', error);
    // Return fallback time: 1 hour from now
    return new Date(Date.now() + (60 * 60 * 1000));
  }
}

/**
 * Calculate follow-up date by adding calendar days, then adjusting to business hours
 * This ensures follow-ups respect the configured delay but skip weekends/hours
 */
async function calculateFollowUpDate(baseDate, daysToAdd, countryCode) {
  const config = await getTimezoneConfig(countryCode);

  // Add the calendar days
  const followUpDate = new Date(baseDate.getTime());
  followUpDate.setDate(followUpDate.getDate() + daysToAdd);

  // Now adjust to business hours (handles weekends and off-hours)
  return await adjustToBusinessHours(followUpDate, countryCode);
}

/**
 * Calculate the first available send time for a recipient
 * Returns the next business hour if currently outside business hours
 */
async function calculateFirstSendTime(countryCode) {
  try {
    const now = new Date();

    // Validate input
    if (!countryCode) {
      console.warn('No country code provided to calculateFirstSendTime, using default');
      countryCode = 'in';
    }

    const result = await adjustToBusinessHours(now, countryCode);

    // Ensure we got a valid Date object back
    if (result && typeof result.getTime === 'function' && !isNaN(result.getTime())) {
      return result;
    } else {
      console.error('calculateFirstSendTime returned invalid date, using fallback');
      return new Date(Date.now() + (60 * 60 * 1000)); // 1 hour from now
    }
  } catch (error) {
    console.error('Error in calculateFirstSendTime:', error);
    // Return fallback time: 1 hour from now
    return new Date(Date.now() + (60 * 60 * 1000));
  }
}

module.exports = {
  getTimezoneConfig,
  isBusinessHour,
  getCountryStatus,
  calculateOptimalSendTime,
  getCountriesInBusiness,
  batchScheduleEmailsByTimezone,
  getSmartSendTimeForContact,
  adjustToBusinessHours,
  calculateFollowUpDate,
  calculateFirstSendTime,
  countryTimezones
};
