#!/usr/bin/env tsx

/**
 * Timezone Seeder Test Script
 *
 * Run this script to test the timezone seeder functionality:
 * npx tsx test-timezone-seeder.ts
 *
 * Tests:
 * 1. Data structure validation
 * 2. Country count verification
 * 3. Weekend pattern analysis
 * 4. Business hours validation
 * 5. Timezone format validation
 */

import { COUNTRY_TIMEZONES, getCountryTimezone, getAllCountryCodes, getCountriesByWeekendPattern, WEEKEND_PATTERNS } from './src/lib/data/country-timezones';
import { validateTimezoneData, exportTimezoneStats } from './src/lib/data/export-timezones';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: TestResult[] = [];

function test(name: string, fn: () => boolean | { passed: boolean; message: string; details?: any }) {
  try {
    const result = fn();
    const passed = typeof result === 'boolean' ? result : result.passed;
    const message = typeof result === 'boolean' ? 'Passed' : result.message;
    const details = typeof result === 'boolean' ? undefined : result.details;

    results.push({ name, passed, message, details });
    console.log(`${passed ? '✅' : '❌'} ${name}: ${message}`);
    if (details) console.log(`   ${JSON.stringify(details, null, 2)}`);
  } catch (error) {
    results.push({ name, passed: false, message: `Error: ${error}` });
    console.log(`❌ ${name}: Error - ${error}`);
  }
}

async function runTests() {
  console.log('🧪 Timezone Seeder Test Suite\n');
  console.log('=' .repeat(60));

  // Test 1: Total country count
  test('Country count (50+)', () => {
    const count = COUNTRY_TIMEZONES.length;
    return {
      passed: count >= 50,
      message: `Found ${count} countries`,
      details: { count, expected: '50+' }
    };
  });

  // Test 2: Required fields present
  test('All required fields present', () => {
    const missingFields: string[] = [];
    COUNTRY_TIMEZONES.forEach((country, index) => {
      if (!country.country_code) missingFields.push(`Row ${index}: Missing country_code`);
      if (!country.country_name) missingFields.push(`Row ${index}: Missing country_name`);
      if (!country.default_timezone) missingFields.push(`Row ${index}: Missing default_timezone`);
      if (!country.business_hours_start) missingFields.push(`Row ${index}: Missing business_hours_start`);
      if (!country.business_hours_end) missingFields.push(`Row ${index}: Missing business_hours_end`);
      if (!country.weekend_days || country.weekend_days.length === 0) missingFields.push(`Row ${index}: Missing weekend_days`);
    });
    return {
      passed: missingFields.length === 0,
      message: missingFields.length === 0 ? 'All fields present' : `${missingFields.length} missing fields`,
      details: missingFields.length > 0 ? { errors: missingFields.slice(0, 5) } : undefined
    };
  });

  // Test 3: Country code format (2 letters)
  test('Country codes are 2 letters', () => {
    const invalid = COUNTRY_TIMEZONES.filter(c => c.country_code.length !== 2);
    return {
      passed: invalid.length === 0,
      message: invalid.length === 0 ? 'All codes valid' : `${invalid.length} invalid codes`,
      details: invalid.length > 0 ? { invalid: invalid.map(c => c.country_code) } : undefined
    };
  });

  // Test 4: Business hours format (HH:MM)
  test('Business hours format (HH:MM)', () => {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    const invalid = COUNTRY_TIMEZONES.filter(c =>
      !timeRegex.test(c.business_hours_start) || !timeRegex.test(c.business_hours_end)
    );
    return {
      passed: invalid.length === 0,
      message: invalid.length === 0 ? 'All times valid' : `${invalid.length} invalid times`,
      details: invalid.length > 0 ? { invalid: invalid.map(c => ({ code: c.country_code, start: c.business_hours_start, end: c.business_hours_end })) } : undefined
    };
  });

  // Test 5: Weekend days are valid
  test('Weekend days are valid', () => {
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const invalid = COUNTRY_TIMEZONES.filter(c =>
      !c.weekend_days || !Array.isArray(c.weekend_days) || c.weekend_days.some(d => !validDays.includes(d))
    );
    return {
      passed: invalid.length === 0,
      message: invalid.length === 0 ? 'All weekend days valid' : `${invalid.length} invalid`,
      details: invalid.length > 0 ? { invalid: invalid.map(c => c.country_code) } : undefined
    };
  });

  // Test 6: IANA timezone format
  test('IANA timezone format', () => {
    const invalid: string[] = [];
    COUNTRY_TIMEZONES.forEach(country => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: country.default_timezone });
      } catch {
        invalid.push(country.country_code);
      }
    });
    return {
      passed: invalid.length === 0,
      message: invalid.length === 0 ? 'All timezones valid' : `${invalid.length} invalid`,
      details: invalid.length > 0 ? { invalid } : undefined
    };
  });

  // Test 7: No duplicate country codes
  test('No duplicate country codes', () => {
    const codes = COUNTRY_TIMEZONES.map(c => c.country_code);
    const unique = new Set(codes);
    return {
      passed: codes.length === unique.size,
      message: codes.length === unique.size ? 'No duplicates' : `${codes.length - unique.size} duplicates`,
      details: codes.length !== unique.size ? { total: codes.length, unique: unique.size } : undefined
    };
  });

  // Test 8: Weekend patterns distribution
  test('Weekend patterns distribution', () => {
    const patterns: Record<string, number> = {};
    COUNTRY_TIMEZONES.forEach(country => {
      const key = country.weekend_days.sort().join(', ');
      patterns[key] = (patterns[key] || 0) + 1;
    });
    return {
      passed: Object.keys(patterns).length >= 2,
      message: `Found ${Object.keys(patterns).length} patterns`,
      details: { patterns }
    };
  });

  // Test 9: Helper function - getCountryTimezone
  test('Helper: getCountryTimezone()', () => {
    const us = getCountryTimezone('US');
    const gb = getCountryTimezone('GB');
    const invalid = getCountryTimezone('INVALID');
    return {
      passed: us?.country_code === 'US' && gb?.country_code === 'GB' && !invalid,
      message: 'Helper function works',
      details: { us: us?.country_name, gb: gb?.country_name, invalid }
    };
  });

  // Test 10: Helper function - getAllCountryCodes()
  test('Helper: getAllCountryCodes()', () => {
    const codes = getAllCountryCodes();
    return {
      passed: codes.length === COUNTRY_TIMEZONES.length && codes.every(c => typeof c === 'string'),
      message: `Returned ${codes.length} codes`,
      details: { sample: codes.slice(0, 5) }
    };
  });

  // Test 11: Helper function - getCountriesByWeekendPattern()
  test('Helper: getCountriesByWeekendPattern()', () => {
    const middleEast = getCountriesByWeekendPattern(WEEKEND_PATTERNS.MIDDLE_EAST);
    return {
      passed: middleEast.length >= 5,
      message: `Found ${middleEast.length} Middle East countries`,
      details: { count: middleEast.length, sample: middleEast.map(c => c.country_code).slice(0, 5) }
    };
  });

  // Test 12: Validation function
  test('Validation function', async () => {
    const validation = await validateTimezoneData('memory');
    return {
      passed: validation.valid,
      message: validation.valid ? 'Data valid' : `${validation.errors.length} errors`,
      details: { errors: validation.errors, warnings: validation.warnings }
    };
  });

  // Test 13: Statistics export
  test('Statistics export', async () => {
    const stats = await exportTimezoneStats();
    return {
      passed: stats.totalCountries === COUNTRY_TIMEZONES.length && Object.keys(stats.weekendPatterns).length > 0,
      message: `Stats for ${stats.totalCountries} countries`,
      details: { weekendPatterns: stats.weekendPatterns }
    };
  });

  // Test 14: Specific country validations
  test('Key countries present', () => {
    const keyCountries = ['US', 'GB', 'IN', 'CA', 'AU', 'AE', 'SA'];
    const present = keyCountries.filter(code => getCountryTimezone(code));
    return {
      passed: present.length === keyCountries.length,
      message: `${present.length}/${keyCountries.length} key countries present`,
      details: { present, missing: keyCountries.filter(c => !getCountryTimezone(c)) }
    };
  });

  // Test 15: Business hours ranges
  test('Business hours ranges', () => {
    const ranges: Record<string, number> = {};
    COUNTRY_TIMEZONES.forEach(country => {
      const range = `${country.business_hours_start}-${country.business_hours_end}`;
      ranges[range] = (ranges[range] || 0) + 1;
    });
    return {
      passed: Object.keys(ranges).length >= 3,
      message: `Found ${Object.keys(ranges).length} different ranges`,
      details: { ranges }
    };
  });

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Summary\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`Total: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.message}`);
    });
  }

  console.log('\n' + '='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
