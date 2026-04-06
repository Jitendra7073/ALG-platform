/**
 * Timezone and Business Hours Module
 *
 * Provides timezone-aware business hours validation for email scheduling.
 * Handles DST transitions, weekends, and business hour adjustments for
 * countries worldwide.
 *
 * @module timezone
 *
 * @example
 * ```typescript
 * import { businessHours } from '@/lib/timezone';
 *
 * // Check if it's business hours
 * const result = businessHours.isBusinessHour(new Date(), 'us');
 *
 * // Calculate next business time
 * const nextTime = businessHours.calculateNextBusinessTime('ae');
 *
 * // Adjust a date to business hours
 * const adjusted = businessHours.adjustToBusinessHours(new Date(), 'uk');
 *
 * // Calculate follow-up date
 * const followUp = businessHours.calculateFollowUpDate(new Date(), 3, 'de');
 * ```
 */

// Main validator class
export { BusinessHoursValidator, businessHours } from './business-hours';

// Types
export type {
  BusinessHoursCheck,
  CountryConfig
} from './business-hours';

// Country configuration utilities
export {
  getCountryConfig,
  getSupportedCountryCodes,
  isCountrySupported,
  COUNTRY_CONFIGS
} from './countries';
