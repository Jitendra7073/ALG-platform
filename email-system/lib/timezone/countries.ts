/**
 * Country Timezone Configuration
 *
 * Provides timezone and business hours data for countries worldwide.
 * Used by the BusinessHoursValidator to calculate optimal email send times.
 *
 * Weekend Days:
 * - 0 = Sunday
 * - 1 = Monday
 * - 2 = Tuesday
 * - 3 = Wednesday
 * - 4 = Thursday
 * - 5 = Friday
 * - 6 = Saturday
 *
 * @module timezone/countries
 */

export interface CountryConfig {
  /** ISO 3166-1 alpha-2 country code (lowercase) */
  code: string;
  /** Full country name */
  name: string;
  /** IANA timezone identifier */
  timezone: string;
  /** Business hours start (0-23, 24-hour format) */
  businessStart: number;
  /** Business hours end (0-23, 24-hour format) */
  businessEnd: number;
  /** Array of weekend day numbers (0=Sunday, 6=Saturday) */
  weekendDays: number[];
  /** UTC offset in hours (for reference, not used in calculations) */
  offsetHours: number;
  /** Preferred send times during business hours (HH:MM format) */
  preferredTimes?: string[];
}

/**
 * Complete country timezone configuration
 * Covers all major countries with proper business hours and weekend patterns
 */
export const COUNTRY_CONFIGS: Record<string, CountryConfig> = {
  // === Asia ===
  in: {
    code: 'in',
    name: 'India',
    timezone: 'Asia/Kolkata',
    businessStart: 9,
    businessEnd: 18,
    weekendDays: [0, 6], // Sunday, Saturday
    offsetHours: 5.5,
    preferredTimes: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00']
  },
  sg: {
    code: 'sg',
    name: 'Singapore',
    timezone: 'Asia/Singapore',
    businessStart: 9,
    businessEnd: 18,
    weekendDays: [0, 6],
    offsetHours: 8,
    preferredTimes: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00']
  },
  jp: {
    code: 'jp',
    name: 'Japan',
    timezone: 'Asia/Tokyo',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 9,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  kr: {
    code: 'kr',
    name: 'South Korea',
    timezone: 'Asia/Seoul',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 9,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  cn: {
    code: 'cn',
    name: 'China',
    timezone: 'Asia/Shanghai',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 8,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  tw: {
    code: 'tw',
    name: 'Taiwan',
    timezone: 'Asia/Taipei',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 8,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  th: {
    code: 'th',
    name: 'Thailand',
    timezone: 'Asia/Bangkok',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 7,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  my: {
    code: 'my',
    name: 'Malaysia',
    timezone: 'Asia/Kuala_Lumpur',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 8,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  id: {
    code: 'id',
    name: 'Indonesia',
    timezone: 'Asia/Jakarta',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 7,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  ph: {
    code: 'ph',
    name: 'Philippines',
    timezone: 'Asia/Manila',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 8,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  vn: {
    code: 'vn',
    name: 'Vietnam',
    timezone: 'Asia/Ho_Chi_Minh',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 7,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  hk: {
    code: 'hk',
    name: 'Hong Kong',
    timezone: 'Asia/Hong_Kong',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 8,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  ae: {
    code: 'ae',
    name: 'United Arab Emirates',
    timezone: 'Asia/Dubai',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [5, 6], // Friday, Saturday
    offsetHours: 4,
    preferredTimes: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00']
  },
  sa: {
    code: 'sa',
    name: 'Saudi Arabia',
    timezone: 'Asia/Riyadh',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [5, 6], // Friday, Saturday
    offsetHours: 3,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  qa: {
    code: 'qa',
    name: 'Qatar',
    timezone: 'Asia/Qatar',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [5, 6], // Friday, Saturday
    offsetHours: 3,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  kw: {
    code: 'kw',
    name: 'Kuwait',
    timezone: 'Asia/Kuwait',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [5, 6], // Friday, Saturday
    offsetHours: 3,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  il: {
    code: 'il',
    name: 'Israel',
    timezone: 'Asia/Jerusalem',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [5, 6], // Friday, Saturday
    offsetHours: 2,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  tr: {
    code: 'tr',
    name: 'Turkey',
    timezone: 'Europe/Istanbul',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 3,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  pk: {
    code: 'pk',
    name: 'Pakistan',
    timezone: 'Asia/Karachi',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 5,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  bd: {
    code: 'bd',
    name: 'Bangladesh',
    timezone: 'Asia/Dhaka',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 6,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  lk: {
    code: 'lk',
    name: 'Sri Lanka',
    timezone: 'Asia/Colombo',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 5.5,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  np: {
    code: 'np',
    name: 'Nepal',
    timezone: 'Asia/Kathmandu',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 5.75,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },

  // === Europe ===
  uk: {
    code: 'uk',
    name: 'United Kingdom',
    timezone: 'Europe/London',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 0,
    preferredTimes: ['09:30', '10:00', '14:00', '15:00', '16:00']
  },
  de: {
    code: 'de',
    name: 'Germany',
    timezone: 'Europe/Berlin',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  fr: {
    code: 'fr',
    name: 'France',
    timezone: 'Europe/Paris',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  it: {
    code: 'it',
    name: 'Italy',
    timezone: 'Europe/Rome',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  es: {
    code: 'es',
    name: 'Spain',
    timezone: 'Europe/Madrid',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  nl: {
    code: 'nl',
    name: 'Netherlands',
    timezone: 'Europe/Amsterdam',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  se: {
    code: 'se',
    name: 'Sweden',
    timezone: 'Europe/Stockholm',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  no: {
    code: 'no',
    name: 'Norway',
    timezone: 'Europe/Oslo',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  dk: {
    code: 'dk',
    name: 'Denmark',
    timezone: 'Europe/Copenhagen',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  fi: {
    code: 'fi',
    name: 'Finland',
    timezone: 'Europe/Helsinki',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 2,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  ch: {
    code: 'ch',
    name: 'Switzerland',
    timezone: 'Europe/Zurich',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  at: {
    code: 'at',
    name: 'Austria',
    timezone: 'Europe/Vienna',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  be: {
    code: 'be',
    name: 'Belgium',
    timezone: 'Europe/Brussels',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  pl: {
    code: 'pl',
    name: 'Poland',
    timezone: 'Europe/Warsaw',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  cz: {
    code: 'cz',
    name: 'Czech Republic',
    timezone: 'Europe/Prague',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  gr: {
    code: 'gr',
    name: 'Greece',
    timezone: 'Europe/Athens',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 2,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  pt: {
    code: 'pt',
    name: 'Portugal',
    timezone: 'Europe/Lisbon',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 0,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  ie: {
    code: 'ie',
    name: 'Ireland',
    timezone: 'Europe/Dublin',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 0,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  ru: {
    code: 'ru',
    name: 'Russia',
    timezone: 'Europe/Moscow',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 3,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  hu: {
    code: 'hu',
    name: 'Hungary',
    timezone: 'Europe/Budapest',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  ro: {
    code: 'ro',
    name: 'Romania',
    timezone: 'Europe/Bucharest',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 2,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  bg: {
    code: 'bg',
    name: 'Bulgaria',
    timezone: 'Europe/Sofia',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 2,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  hr: {
    code: 'hr',
    name: 'Croatia',
    timezone: 'Europe/Zagreb',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },
  ua: {
    code: 'ua',
    name: 'Ukraine',
    timezone: 'Europe/Kyiv',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 2,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00', '16:00']
  },

  // === North America ===
  us: {
    code: 'us',
    name: 'United States',
    timezone: 'America/New_York',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -5,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  ca: {
    code: 'ca',
    name: 'Canada',
    timezone: 'America/Toronto',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -5,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  mx: {
    code: 'mx',
    name: 'Mexico',
    timezone: 'America/Mexico_City',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -6,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },

  // === South America ===
  br: {
    code: 'br',
    name: 'Brazil',
    timezone: 'America/Sao_Paulo',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -3,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  ar: {
    code: 'ar',
    name: 'Argentina',
    timezone: 'America/Argentina/Buenos_Aires',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -3,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  co: {
    code: 'co',
    name: 'Colombia',
    timezone: 'America/Bogota',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -5,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  cl: {
    code: 'cl',
    name: 'Chile',
    timezone: 'America/Santiago',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -4,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  pe: {
    code: 'pe',
    name: 'Peru',
    timezone: 'America/Lima',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -5,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  ve: {
    code: 've',
    name: 'Venezuela',
    timezone: 'America/Caracas',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -4,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  ec: {
    code: 'ec',
    name: 'Ecuador',
    timezone: 'America/Guayaquil',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: -5,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },

  // === Oceania ===
  au: {
    code: 'au',
    name: 'Australia',
    timezone: 'Australia/Sydney',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 10,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  nz: {
    code: 'nz',
    name: 'New Zealand',
    timezone: 'Pacific/Auckland',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 12,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  fj: {
    code: 'fj',
    name: 'Fiji',
    timezone: 'Pacific/Fiji',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 12,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },

  // === Africa ===
  za: {
    code: 'za',
    name: 'South Africa',
    timezone: 'Africa/Johannesburg',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 2,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  ng: {
    code: 'ng',
    name: 'Nigeria',
    timezone: 'Africa/Lagos',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  ke: {
    code: 'ke',
    name: 'Kenya',
    timezone: 'Africa/Nairobi',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 3,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  eg: {
    code: 'eg',
    name: 'Egypt',
    timezone: 'Africa/Cairo',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [5, 6], // Friday, Saturday
    offsetHours: 2,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  ma: {
    code: 'ma',
    name: 'Morocco',
    timezone: 'Africa/Casablanca',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  gh: {
    code: 'gh',
    name: 'Ghana',
    timezone: 'Africa/Accra',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 0,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },
  tn: {
    code: 'tn',
    name: 'Tunisia',
    timezone: 'Africa/Tunis',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 1,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  },

  // === Default/Fallback ===
  unknown: {
    code: 'unknown',
    name: 'Unknown/Other',
    timezone: 'UTC',
    businessStart: 9,
    businessEnd: 17,
    weekendDays: [0, 6],
    offsetHours: 0,
    preferredTimes: ['09:00', '10:00', '14:00', '15:00']
  }
};

/**
 * Get country configuration by code
 * @param code - ISO 3166-1 alpha-2 country code (case-insensitive)
 * @returns Country configuration or default US config if not found
 */
export function getCountryConfig(code: string): CountryConfig {
  const normalizedCode = code.toLowerCase().trim();
  return COUNTRY_CONFIGS[normalizedCode] || COUNTRY_CONFIGS.us;
}

/**
 * Get all supported country codes
 * @returns Array of all supported country codes (lowercase)
 */
export function getSupportedCountryCodes(): string[] {
  return Object.keys(COUNTRY_CONFIGS).filter(code => code !== 'unknown');
}

/**
 * Check if a country code is supported
 * @param code - ISO 3166-1 alpha-2 country code (case-insensitive)
 * @returns True if country is supported
 */
export function isCountrySupported(code: string): boolean {
  const normalizedCode = code.toLowerCase().trim();
  return normalizedCode in COUNTRY_CONFIGS;
}
