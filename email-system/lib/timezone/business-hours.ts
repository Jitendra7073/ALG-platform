/**
 * Business Hours Validator
 *
 * Validates and calculates business hours for different countries/timezones.
 * Handles DST transitions, weekends, and business hour adjustments.
 *
 * Uses Intl.DateTimeFormat for accurate timezone conversions, ensuring
 * proper handling of Daylight Saving Time transitions and other timezone
 * anomalies.
 *
 * @module timezone/business-hours
 */

import { getCountryConfig, COUNTRY_CONFIGS, type CountryConfig } from './countries';

/**
 * Result of a business hours check
 */
export interface BusinessHoursCheck {
  /** Whether the time is within business hours */
  isBusinessHours: boolean;
  /** Reason if not in business hours */
  reason?: 'weekend' | 'outside_hours' | 'open';
  /** Local time in the target timezone */
  localTime: string;
  /** Local day of week */
  localDay: string;
  /** Local hour (0-23) */
  localHour: number;
  /** Country configuration used */
  config: CountryConfig;
}

/**
 * Business Hours Validator Class
 *
 * Provides methods to check if a given time is within business hours
 * for a specific country, calculate the next business time, and adjust
 * dates to fall within business hours.
 */
export class BusinessHoursValidator {
  private configCache: Map<string, CountryConfig> = new Map();

  /**
   * Get country configuration with caching
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns Country configuration
   */
  private getConfig(countryCode: string): CountryConfig {
    const normalizedCode = countryCode.toLowerCase().trim();

    if (!this.configCache.has(normalizedCode)) {
      this.configCache.set(normalizedCode, getCountryConfig(normalizedCode));
    }

    return this.configCache.get(normalizedCode)!;
  }

  /**
   * Get time components in the target timezone
   * @param date - Date to convert
   * @param timezone - IANA timezone identifier
   * @returns Object with hour, day, and formatted time string
   */
  private getTimezoneComponents(date: Date, timezone: string): {
    hour: number;
    day: number;
    dayName: string;
    timeString: string;
    dateString: string;
  } {
    // Get hour using Intl API
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false
    });

    const hourParts = hourFormatter.formatToParts(date);
    const hourPart = hourParts.find(p => p.type === 'hour');
    const hour = hourPart ? parseInt(hourPart.value, 10) : 0;

    // Get day of week using Intl API
    const dayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long'
    });
    const dayName = dayFormatter.format(date);

    // Map day name to number (0 = Sunday, 1 = Monday, etc.)
    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };
    const day = dayMap[dayName.toLowerCase()];

    // Get formatted time string
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const timeString = timeFormatter.format(date);

    // Get formatted date string
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const dateString = dateFormatter.format(date);

    return { hour, day, dayName, timeString, dateString };
  }

  /**
   * Check if a given time is during business hours for a country
   *
   * @param date - Date to check (defaults to current time)
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns Detailed business hours check result
   *
   * @example
   * ```typescript
   * const validator = new BusinessHoursValidator();
   * const result = validator.isBusinessHour(new Date(), 'us');
   * console.log(result.isBusinessHours); // true or false
   * console.log(result.reason); // 'weekend', 'outside_hours', or 'open'
   * ```
   */
  isBusinessHour(date: Date, countryCode: string): BusinessHoursCheck {
    const config = this.getConfig(countryCode);
    const components = this.getTimezoneComponents(date, config.timezone);

    // Check if it's a weekend
    if (config.weekendDays.includes(components.day)) {
      return {
        isBusinessHours: false,
        reason: 'weekend',
        localTime: components.timeString,
        localDay: components.dayName,
        localHour: components.hour,
        config
      };
    }

    // Check if it's within business hours
    const withinHours = components.hour >= config.businessStart &&
                        components.hour < config.businessEnd;

    return {
      isBusinessHours: withinHours,
      reason: withinHours ? 'open' : 'outside_hours',
      localTime: components.timeString,
      localDay: components.dayName,
      localHour: components.hour,
      config
    };
  }

  /**
   * Calculate the next valid business time for a country
   *
   * Starts checking from the next hour and finds the first time that falls
   * within business hours. Will search up to 7 days ahead.
   *
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @param fromDate - Date to start searching from (defaults to now + 1 hour)
   * @returns Next business time as Date object
   *
   * @example
   * ```typescript
   * const validator = new BusinessHoursValidator();
   * const nextTime = validator.calculateNextBusinessTime('ae');
   * console.log(nextTime); // Next valid business hour for UAE
   * ```
   */
  calculateNextBusinessTime(countryCode: string, fromDate?: Date): Date {
    const config = this.getConfig(countryCode);
    const startDate = fromDate || new Date();

    // Start from the next hour to avoid past times
    let checkDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    // Try to find the next business hour within the next 7 days
    const maxDays = 7;
    const maxAttempts = maxDays * 24; // Check each hour for 7 days
    const hourIncrement = 60 * 60 * 1000; // 1 hour in milliseconds

    for (let i = 0; i < maxAttempts; i++) {
      const testDate = new Date(checkDate.getTime() + i * hourIncrement);
      const result = this.isBusinessHour(testDate, countryCode);

      if (result.isBusinessHours) {
        // Check if this is a preferred time (if configured)
        if (config.preferredTimes && config.preferredTimes.length > 0) {
          const components = this.getTimezoneComponents(testDate, config.timezone);
          const [hours, minutes] = components.timeString.split(':').map(Number);

          // Check if this is one of the preferred times (or close to it)
          const isPreferredTime = config.preferredTimes.some(preferred => {
            const [prefHour, prefMin] = preferred.split(':').map(Number);
            // Allow within 30 minutes of preferred time
            return hours === prefHour && Math.abs(minutes - (prefMin || 0)) <= 30;
          });

          if (isPreferredTime) {
            return testDate;
          }
        } else {
          // No preferred times configured, return first business hour
          return testDate;
        }
      }
    }

    // Fallback: return 1 day from now at business start time
    const fallbackDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    fallbackDate.setHours(config.businessStart, 0, 0, 0);
    return fallbackDate;
  }

  /**
   * Add calendar days to a date and adjust to business hours
   *
   * This is useful for calculating follow-up dates. For example, if you
   * want to send a follow-up email 3 days after the initial email, this
   * method will add 3 calendar days and then adjust the result to fall
   * within business hours (skipping weekends and off-hours).
   *
   * @param baseDate - Base date to add days to
   * @param daysToAdd - Number of calendar days to add
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns Adjusted date within business hours
   *
   * @example
   * ```typescript
   * const validator = new BusinessHoursValidator();
   * const sentDate = new Date('2024-01-01T10:00:00Z');
   * const followUpDate = validator.calculateFollowUpDate(sentDate, 3, 'us');
   * // Returns date 3 days later, adjusted to US business hours
   * ```
   */
  calculateFollowUpDate(baseDate: Date, daysToAdd: number, countryCode: string): Date {
    const config = this.getConfig(countryCode);

    // Add the calendar days
    const followUpDate = new Date(baseDate.getTime());
    followUpDate.setDate(followUpDate.getDate() + daysToAdd);

    // Now adjust to business hours (handles weekends and off-hours)
    return this.adjustToBusinessHours(followUpDate, countryCode);
  }

  /**
   * Adjust a date to fall within business hours
   *
   * If the date is outside business hours or on a weekend, this method
   * will move it forward to the next valid business hour.
   *
   * Handles:
   * - Weekends (moves to next business day)
   * - Before business hours (moves to start time same day)
   * - After business hours (moves to start time next business day)
   * - DST transitions (uses Intl API for accurate conversion)
   *
   * @param date - Date to adjust
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns Adjusted date within business hours
   *
   * @example
   * ```typescript
   * const validator = new BusinessHoursValidator();
   * const saturday = new Date('2024-01-06T10:00:00Z'); // Saturday
   * const adjusted = validator.adjustToBusinessHours(saturday, 'us');
   * // Returns Monday at business start time
   * ```
   */
  adjustToBusinessHours(date: Date, countryCode: string): Date {
    const config = this.getConfig(countryCode);
    let adjustedDate = new Date(date.getTime());

    // Keep checking until we find a valid business hour
    while (true) {
      const components = this.getTimezoneComponents(adjustedDate, config.timezone);

      // Check if it's a weekend
      if (config.weekendDays.includes(components.day)) {
        // Move to next day at business start time
        adjustedDate.setDate(adjustedDate.getDate() + 1);
        adjustedDate.setHours(config.businessStart, 0, 0, 0);
        continue;
      }

      // Check if before business hours
      if (components.hour < config.businessStart) {
        // Set to business start time on the same day
        // We need to create a new date object to ensure the hour is set correctly
        // in the target timezone (this handles DST properly)
        const year = parseInt(adjustedDate.getFullYear().toString(), 10);
        const month = parseInt(adjustedDate.getMonth().toString(), 10);
        const day = parseInt(adjustedDate.getDate().toString(), 10);

        // Use Intl API to create a date in the target timezone
        const targetDate = new Date(
          Date.UTC(year, month, day, config.businessStart, 0, 0)
        );

        // Format to target timezone and parse back
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: config.timezone,
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          hour12: false
        });

        const parts = formatter.formatToParts(targetDate);
        const partValues: Record<string, string> = {};
        parts.forEach(part => {
          partValues[part.type] = part.value;
        });

        adjustedDate = new Date(
          parseInt(partValues.year!, 10),
          parseInt(partValues.month!, 10) - 1,
          parseInt(partValues.day!, 10),
          parseInt(partValues.hour!, 10),
          parseInt(partValues.minute!, 10),
          0
        );

        return adjustedDate;
      }

      // Check if after business hours
      if (components.hour >= config.businessEnd) {
        // Move to next day at business start time
        adjustedDate.setDate(adjustedDate.getDate() + 1);
        adjustedDate.setHours(config.businessStart, 0, 0, 0);
        continue;
      }

      // We're within business hours
      return adjustedDate;
    }
  }

  /**
   * Get all countries currently in business hours
   *
   * @param date - Date to check (defaults to current time)
   * @returns Array of country codes and their local times
   *
   * @example
   * ```typescript
   * const validator = new BusinessHoursValidator();
   * const inBusiness = validator.getCountriesInBusiness();
   * console.log(inBusiness);
   * // [{ country: 'us', localTime: '14:30', ... }, ...]
   * ```
   */
  getCountriesInBusiness(date?: Date): Array<{
    country: string;
    name: string;
    timezone: string;
    localTime: string;
    localDay: string;
    localHour: number;
  }> {
    const checkDate = date || new Date();
    const countriesInBusiness: Array<{
      country: string;
      name: string;
      timezone: string;
      localTime: string;
      localDay: string;
      localHour: number;
    }> = [];

    for (const config of Object.values(COUNTRY_CONFIGS)) {
      if (config.code === 'unknown') continue;

      const result = this.isBusinessHour(checkDate, config.code);

      if (result.isBusinessHours) {
        countriesInBusiness.push({
          country: config.code,
          name: config.name,
          timezone: config.timezone,
          localTime: result.localTime,
          localDay: result.localDay,
          localHour: result.localHour
        });
      }
    }

    // Sort by local hour (earliest business hours first)
    return countriesInBusiness.sort((a, b) => a.localHour - b.localHour);
  }

  /**
   * Get the status of a country at a specific time
   *
   * @param date - Date to check
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns Status: 'weekend', 'outside_hours', or 'open'
   *
   * @example
   * ```typescript
   * const validator = new BusinessHoursValidator();
   * const status = validator.getCountryStatus(new Date(), 'uk');
   * console.log(status); // 'open', 'weekend', or 'outside_hours'
   * ```
   */
  getCountryStatus(date: Date, countryCode: string): 'weekend' | 'outside_hours' | 'open' {
    const result = this.isBusinessHour(date, countryCode);
    return result.reason || 'open';
  }

  /**
   * Calculate the optimal send time for an email
   *
   * This method considers:
   * - Business hours
   * - Preferred send times (if configured)
   * - Current time (won't schedule in the past)
   *
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @param afterDate - Earliest date to send (defaults to now + 1 hour)
   * @returns Optimal send time
   *
   * @example
   * ```typescript
   * const validator = new BusinessHoursValidator();
   * const sendTime = validator.calculateOptimalSendTime('de');
   * console.log(sendTime); // Next preferred business time for Germany
   * ```
   */
  calculateOptimalSendTime(countryCode: string, afterDate?: Date): Date {
    return this.calculateNextBusinessTime(countryCode, afterDate);
  }

  /**
   * Check if DST is active in a timezone on a specific date
   *
   * @param date - Date to check
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns True if DST is active
   *
   * @example
   * ```typescript
   * const validator = new BusinessHoursValidator();
   * const isDST = validator.isDSTActive(new Date(), 'us');
   * console.log(isDST); // true or false
   * ```
   */
  isDSTActive(date: Date, countryCode: string): boolean {
    const config = this.getConfig(countryCode);

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      timeZoneName: 'long'
    });

    const parts = formatter.formatToParts(date);
    const tzName = parts.find(p => p.type === 'timeZoneName')?.value || '';

    // Check if timezone name contains "Daylight" or "Summer"
    return /daylight|summer/i.test(tzName);
  }

  /**
   * Clear the configuration cache
   *
   * Useful if you need to reload country configurations.
   */
  clearCache(): void {
    this.configCache.clear();
  }
}

/**
 * Default singleton instance of BusinessHoursValidator
 *
 * Use this for most cases. Create a new instance only if you need
 * separate cache management.
 */
export const businessHours = new BusinessHoursValidator();

/**
 * Re-export types and utilities for convenience
 */
export type { CountryConfig };
export { getCountryConfig, getSupportedCountryCodes, isCountrySupported } from './countries';
