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
 */
function getTimezoneConfig(countryCode) {
  return countryTimezones[countryCode.toLowerCase()] || countryTimezones['us'];
}

/**
 * Check if a given time is during business hours in a specific timezone
 */
function isBusinessHour(date, countryCode) {
  const config = getTimezoneConfig(countryCode);

  // Convert to recipient's timezone
  const recipientTime = convertToTimezone(date, config.timezone);
  const hour = recipientTime.getHours();
  const day = recipientTime.getDay();

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
function calculateOptimalSendTime(countryCode, baseTime = new Date()) {
  const config = getTimezoneConfig(countryCode);

  // Try to find the next optimal time within the next 7 days
  const maxDays = 7;
  const checkInterval = 30 * 60 * 1000; // Check every 30 minutes

  for (let day = 0; day < maxDays; day++) {
    const checkDate = new Date(baseTime);
    checkDate.setDate(checkDate.getDate() + day);

    // Reset to start of day in recipient's timezone
    const recipientDate = convertToTimezone(checkDate, config.timezone);
    recipientDate.setHours(config.businessStart, 0, 0, 0);

    // Check each preferred time
    for (const timeStr of config.preferredTimes) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      recipientDate.setHours(hours, minutes, 0, 0);

      if (isBusinessHour(recipientDate, countryCode)) {
        // This is a valid business time
        // Check if it's in the future (not in the past)
        if (recipientDate > new Date()) {
          return recipientDate;
        }
      }
    }
  }

  // Fallback: return next business day morning
  const fallbackDate = new Date(baseTime);
  fallbackDate.setDate(fallbackDate.getDate() + 1);
  const recipientFallback = convertToTimezone(fallbackDate, config.timezone);
  recipientFallback.setHours(config.businessStart, 0, 0, 0);

  return recipientFallback;
}

/**
 * Convert a date to a specific timezone
 */
function convertToTimezone(date, timezone) {
  // This is a simplified version
  // In production, use a library like 'date-fns-tz' or 'luxon'
  const offsetMap = {
    'Asia/Kolkata': 5.5 * 60,
    'America/New_York': -5 * 60,
    'Europe/London': 0 * 60,
    'America/Toronto': -5 * 60,
    'Australia/Sydney': 10 * 60,
    'Europe/Berlin': 1 * 60,
    'Europe/Paris': 1 * 60,
    'Asia/Tokyo': 9 * 60,
    'Asia/Singapore': 8 * 60,
    'Asia/Dubai': 4 * 60
  };

  const offsetMinutes = offsetMap[timezone] || 0;
  const utcDate = new Date(date);
  const localDate = new Date(utcDate.getTime() + offsetMinutes * 60 * 1000);

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
      countriesInBusiness.push({
        country: code,
        name: config.name,
        timezone: config.timezone,
        currentLocalTime: convertToTimezone(now, config.timezone)
      });
    }
  }

  return countriesInBusiness.sort((a, b) =>
    a.currentLocalTime.getTime() - b.currentLocalTime.getTime()
  );
}

/**
 * Batch schedule emails by timezone groups
 */
function batchScheduleEmailsByTimezone(emails) {
  const timezoneBatches = {};

  emails.forEach(email => {
    const countryCode = email.country || 'us';
    const config = getTimezoneConfig(countryCode);
    const optimalTime = calculateOptimalSendTime(countryCode);

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
  });

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

module.exports = {
  getTimezoneConfig,
  isBusinessHour,
  calculateOptimalSendTime,
  getCountriesInBusiness,
  batchScheduleEmailsByTimezone,
  getSmartSendTimeForContact,
  countryTimezones
};
