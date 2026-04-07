# Email System - Timezone-Aware Scheduling

## Overview

The scheduling system ensures emails are sent during recipient's business hours, avoiding weekends, and properly converting timezones. This is critical for international email campaigns.

## Core Concepts

### 1. Timezone Database

**Table**: `country_timezones`

```sql
CREATE TABLE country_timezones (
  country_code TEXT PRIMARY KEY,
  country_name TEXT NOT NULL,
  default_timezone TEXT NOT NULL, -- IANA timezone: Asia/Kolkata, America/New_York
  business_hours_start TIME DEFAULT '09:00',
  business_hours_end TIME DEFAULT '18:00',
  weekend_days TEXT[] DEFAULT ARRAY['Saturday', 'Sunday']
);
```

**Example Data**:
```json
{
  "US": {
    "country_name": "United States",
    "default_timezone": "America/New_York",
    "business_hours_start": "09:00",
    "business_hours_end": "18:00",
    "weekend_days": ["Saturday", "Sunday"]
  },
  "IN": {
    "country_name": "India",
    "default_timezone": "Asia/Kolkata",
    "business_hours_start": "09:00",
    "business_hours_end": "18:00",
    "weekend_days": ["Saturday", "Sunday"]
  },
  "UK": {
    "country_name": "United Kingdom",
    "default_timezone": "Europe/London",
    "business_hours_start": "09:00",
    "business_hours_end": "18:00",
    "weekend_days": ["Saturday", "Sunday"]
  },
  "AE": {
    "country_name": "United Arab Emirates",
    "default_timezone": "Asia/Dubai",
    "business_hours_start": "09:00",
    "business_hours_end": "18:00",
    "weekend_days": ["Friday", "Saturday"]
  }
}
```

### 2. Scheduling Algorithm

#### Step 1: Calculate Initial Schedule
```
Input:
  - Base time: Current time in sender's timezone
  - Gap: days, hours, minutes, specific time
  - Recipient timezone

Process:
  1. Add gap to base time
  2. If specific_time provided, set time to that
  3. Convert to recipient timezone
  4. Check if weekend
  5. Check if business hours
  6. Adjust if needed
  7. Convert back to sender timezone for storage
```

#### Step 2: Weekend Detection
```
Algorithm:
  IF recipient_time.day IN weekend_days THEN
    // Find next Monday (or first non-weekend day)
    adjusted_time = find_next_business_day(recipient_time)
    RETURN adjusted_time
  END IF
```

#### Step 3: Business Hours Check
```
Algorithm:
  recipient_time_hour = recipient_time.hour
  business_start = country.business_hours_start (e.g., 09:00)
  business_end = country.business_hours_end (e.g., 18:00)
  
  IF recipient_time_hour < business_start.hour THEN
    // Too early, schedule to business_start
    adjusted_time = set_time(recipient_time, business_start)
  ELSE IF recipient_time_hour > business_end.hour THEN
    // Too late, schedule to next day business_start
    adjusted_time = add_days(set_time(recipient_time, business_start), 1)
    // Check if this is weekend
    adjusted_time = check_weekend(adjusted_time)
  END IF
```

#### Step 4: Timezone Conversion
```
Algorithm:
  sender_time = "2026-04-07T09:00:00+05:30" (IST)
  recipient_timezone = "America/New_York"
  
  // Convert to recipient timezone
  recipient_time = convert_timezone(sender_time, "Asia/Kolkata", "America/New_York")
  // Result: "2026-04-06T22:30:00-05:00" (previous day!)
  
  // Check business hours
  IF NOT is_business_hours(recipient_time) THEN
    recipient_time = adjust_to_business_hours(recipient_time)
  END IF
  
  // Check weekend
  IF is_weekend(recipient_time) THEN
    recipient_time = adjust_to_next_business_day(recipient_time)
  END IF
  
  // Convert back to sender timezone for storage
  storage_time = convert_timezone(recipient_time, "America/New_York", "Asia/Kolkata")
```

## Implementation

### JavaScript/Node.js Implementation

```javascript
// lib/timezone-scheduler.js

const { DateTime } = require('luxon');

class TimezoneScheduler {
  constructor(db) {
    this.db = db;
    this.senderTimezone = 'Asia/Kolkata'; // Default: India
  }

  /**
   * Calculate timezone-aware schedule for an email
   */
  async calculateSchedule({
    baseTime,
    gapDays = 0,
    gapHours = 0,
    gapMinutes = 0,
    sendTime = null, // HH:MM format
    recipientCountry = 'US',
    recipientTimezone = null
  }) {
    // 1. Get timezone info for recipient country
    const timezoneInfo = await this.getTimezoneInfo(recipientCountry);
    const targetTimezone = recipientTimezone || timezoneInfo.default_timezone;

    // 2. Calculate initial scheduled time
    let scheduledTime = DateTime.fromISO(baseTime, { zone: this.senderTimezone });
    
    // Add gaps
    scheduledTime = scheduledTime
      .plus({ days: gapDays, hours: gapHours, minutes: gapMinutes });

    // Set specific time if provided
    if (sendTime) {
      const [hours, minutes] = sendTime.split(':').map(Number);
      scheduledTime = scheduledTime.set({ hour: hours, minute: minutes });
    }

    // 3. Convert to recipient timezone
    const recipientTime = scheduledTime.setZone(targetTimezone);

    // 4. Check and adjust for weekend
    const weekendAdjustment = this.checkWeekend(recipientTime, timezoneInfo);
    let adjustedTime = weekendAdjustment.time;
    const adjustments = [...weekendAdjustment.adjustments];

    // 5. Check and adjust for business hours
    const businessHoursAdjustment = this.checkBusinessHours(adjustedTime, timezoneInfo);
    adjustedTime = businessHoursAdjustment.time;
    adjustments.push(...businessHoursAdjustment.adjustments);

    // 6. Convert back to sender timezone for storage
    const storageTime = adjustedTime.setZone(this.senderTimezone);

    return {
      original_scheduled_at: scheduledTime.toUTC().toISO(),
      adjusted_scheduled_at: storageTime.toUTC().toISO(),
      timezone_conversion: {
        from_timezone: this.senderTimezone,
        to_timezone: targetTimezone,
        from_time: storageTime.toISO(),
        to_time: adjustedTime.toISO()
      },
      business_hours_check: {
        is_business_hours: businessHoursAdjustment.isBusinessHours,
        business_hours_start: timezoneInfo.business_hours_start,
        business_hours_end: timezoneInfo.business_hours_end,
        recipient_time: adjustedTime.toFormat('HH:mm:ss')
      },
      weekend_check: {
        is_weekend: weekendAdjustment.isWeekend,
        day_of_week: adjustedTime.toFormat('cccc')
      },
      adjustments
    };
  }

  /**
   * Check if time falls on weekend and adjust if needed
   */
  checkWeekend(time, timezoneInfo) {
    const dayOfWeek = time.toFormat('cccc'); // Monday, Tuesday, etc.
    const isWeekend = timezoneInfo.weekend_days.includes(dayOfWeek);

    if (!isWeekend) {
      return {
        time,
        isWeekend: false,
        adjustments: []
      };
    }

    // Find next business day (Monday for Sat/Sun, Sunday for Fri/Sat in Middle East)
    let adjustedTime = time;
    let daysToAdd = 1;

    while (timezoneInfo.weekend_days.includes(adjustedTime.toFormat('cccc'))) {
      adjustedTime = adjustedTime.plus({ days: daysToAdd });
      daysToAdd++;
    }

    // Set to business hours start
    const [hours, minutes] = timezoneInfo.business_hours_start.split(':').map(Number);
    adjustedTime = adjustedTime.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });

    return {
      time: adjustedTime,
      isWeekend: true,
      adjustments: [{
        type: 'weekend',
        reason: `Original time landed on ${dayOfWeek}`,
        from: time.toISO(),
        to: adjustedTime.toISO()
      }]
    };
  }

  /**
   * Check if time is within business hours and adjust if needed
   */
  checkBusinessHours(time, timezoneInfo) {
    const hour = time.hour;
    const [startHour, startMinute] = timezoneInfo.business_hours_start.split(':').map(Number);
    const [endHour, endMinute] = timezoneInfo.business_hours_end.split(':').map(Number);

    // Check if within business hours
    const isBusinessHours = hour >= startHour && hour < endHour;

    if (isBusinessHours) {
      return {
        time,
        isBusinessHours: true,
        adjustments: []
      };
    }

    // Adjust to next business day start
    let adjustedTime = time;
    const adjustments = [];

    if (hour < startHour) {
      // Too early, schedule to business start same day
      adjustedTime = time.set({ 
        hour: startHour, 
        minute: startMinute, 
        second: 0, 
        millisecond: 0 
      });

      adjustments.push({
        type: 'before_business_hours',
        reason: `Time ${hour}:${time.minute} is before business hours`,
        from: time.toISO(),
        to: adjustedTime.toISO()
      });
    } else {
      // Too late, schedule to next day business start
      adjustedTime = time.plus({ days: 1 }).set({ 
        hour: startHour, 
        minute: startMinute, 
        second: 0, 
        millisecond: 0 
      });

      adjustments.push({
        type: 'after_business_hours',
        reason: `Time ${hour}:${time.minute} is after business hours`,
        from: time.toISO(),
        to: adjustedTime.toISO()
      });

      // Check if this landed on weekend
      const weekendCheck = this.checkWeekend(adjustedTime, timezoneInfo);
      if (weekendCheck.isWeekend) {
        adjustedTime = weekendCheck.time;
        adjustments.push(...weekendCheck.adjustments);
      }
    }

    return {
      time: adjustedTime,
      isBusinessHours: false,
      adjustments
    };
  }

  /**
   * Get timezone info for a country
   */
  async getTimezoneInfo(countryCode) {
    const result = await this.db.query(
      'SELECT * FROM country_timezones WHERE country_code = $1',
      [countryCode]
    );

    if (result.rows.length === 0) {
      // Fallback to default US timezone
      return {
        country_code: 'US',
        default_timezone: 'America/New_York',
        business_hours_start: '09:00',
        business_hours_end: '18:00',
        weekend_days: ['Saturday', 'Sunday']
      };
    }

    return result.rows[0];
  }

  /**
   * Format timezone conversion for display
   */
  formatTimezoneConversion(conversion) {
    const fromTime = DateTime.fromISO(conversion.from_time);
    const toTime = DateTime.fromISO(conversion.to_time);

    return {
      sender_time: fromTime.toFormat('DDDD t ZZZZ'), // "Monday 9:00 AM IST"
      recipient_time: toTime.toFormat('DDDD t ZZZZ'), // "Sunday 11:30 PM EST"
      conversion_string: `${fromTime.toFormat('DDD t')} → ${toTime.toFormat('DDD t')}`
    };
  }
}

module.exports = TimezoneScheduler;
```

## Usage Examples

### Example 1: India to US (Weekend + Night Scenario)

```javascript
const scheduler = new TimezoneScheduler(db);

const result = await scheduler.calculateSchedule({
  baseTime: '2026-04-06T09:00:00+05:30', // Monday 9:00 AM IST
  gapDays: 0,
  gapHours: 0,
  gapMinutes: 0,
  sendTime: '09:00',
  recipientCountry: 'US',
  recipientTimezone: 'America/New_York'
});

console.log(result);
```

**Output**:
```json
{
  "original_scheduled_at": "2026-04-06T03:30:00Z",
  "adjusted_scheduled_at": "2026-04-07T03:30:00Z",
  "timezone_conversion": {
    "from_timezone": "Asia/Kolkata",
    "to_timezone": "America/New_York",
    "from_time": "2026-04-07T09:00:00+05:30",
    "to_time": "2026-04-06T23:30:00-05:00"
  },
  "business_hours_check": {
    "is_business_hours": false,
    "business_hours_start": "09:00",
    "business_hours_end": "18:00",
    "recipient_time": "23:30:00"
  },
  "weekend_check": {
    "is_weekend": true,
    "day_of_week": "Sunday"
  },
  "adjustments": [
    {
      "type": "weekend",
      "reason": "Original time landed on Sunday",
      "from": "2026-04-06T23:30:00-05:00",
      "to": "2026-04-07T09:00:00-05:00"
    }
  ]
}
```

**Display to User**:
```
Original: Monday 9:00 AM your time
Recipient: Sunday 11:30 PM EST (weekend + night)
Adjusted: Tuesday 6:30 PM your time (9:00 AM EST)
```

### Example 2: Sequential Emails in Campaign

```javascript
// Email 1: Welcome (Monday 9:00 AM IST)
const email1 = await scheduler.calculateSchedule({
  baseTime: '2026-04-07T09:00:00+05:30',
  gapDays: 0,
  sendTime: '09:00',
  recipientCountry: 'US'
});

// Email 2: Follow-up (2 days after Email 1, at 10:30 AM)
const email2 = await scheduler.calculateSchedule({
  baseTime: email1.adjusted_scheduled_at,
  gapDays: 2,
  sendTime: '10:30',
  recipientCountry: 'US'
});

// Email 3: Promotion (4 days after Email 2, at 2:00 PM)
const email3 = await scheduler.calculateSchedule({
  baseTime: email2.adjusted_scheduled_at,
  gapDays: 4,
  sendTime: '14:00',
  recipientCountry: 'US'
});
```

**Campaign Schedule Display**:
```
Campaign: April Coupon
Recipient: john@example.com (US, New York)

Email 1: Welcome Email
  Scheduled: Monday 6:30 PM IST (9:00 AM EST)
  Status: Pending

Email 2: Follow-up 1
  Scheduled: Thursday 8:00 PM IST (10:30 AM EST)
  Gap: 2 days + 10:30 AM
  Status: Pending (waiting for Email 1)

Email 3: Promotion
  Scheduled: Monday 6:30 PM IST (9:00 AM EST)
  Gap: 4 days + 2:00 PM
  Status: Pending (waiting for Email 2)
```

### Example 3: Multiple Timezones in Single Campaign

```javascript
const contacts = [
  { email: 'john@example.com', country: 'US', timezone: 'America/New_York' },
  { email: 'jane@example.com', country: 'UK', timezone: 'Europe/London' },
  { email: 'raj@example.com', country: 'IN', timezone: 'Asia/Kolkata' }
];

for (const contact of contacts) {
  const schedule = await scheduler.calculateSchedule({
    baseTime: '2026-04-07T09:00:00+05:30', // Monday 9:00 AM IST
    gapDays: 0,
    sendTime: '09:00',
    recipientCountry: contact.country,
    recipientTimezone: contact.timezone
  });

  console.log(`${contact.email}:`);
  console.log(`  Your time: ${DateTime.fromISO(schedule.adjusted_scheduled_at).toFormat('DDD t ZZZZ')}`);
  console.log(`  Their time: ${DateTime.fromISO(schedule.timezone_conversion.to_time).toFormat('DDD t ZZZZ')}`);
  console.log('');
}
```

**Output**:
```
john@example.com:
  Your time: Monday 6:30 PM IST
  Their time: Monday 9:00 AM EST

jane@example.com:
  Your time: Monday 1:30 PM IST
  Their time: Monday 9:00 AM BST

raj@example.com:
  Your time: Monday 9:00 AM IST
  Their time: Monday 9:00 AM IST
```

## UI Display Guidelines

### Campaign Queue Display

```html
<div class="email-queue-item">
  <div class="email-info">
    <h3>Email #1: Welcome Email</h3>
    <p>Recipient: john@example.com</p>
    <div class="schedule-info">
      <span class="sender-time">
        📅 Monday 6:30 PM IST
      </span>
      <span class="conversion-arrow">→</span>
      <span class="recipient-time">
        🌍 Monday 9:00 AM EST
      </span>
    </div>
    <div class="adjustments" ng-if="email.adjustments.length > 0">
      <span class="badge badge-info">
        Adjusted for {{email.adjustments[0].type}}
      </span>
    </div>
  </div>
  <div class="actions">
    <button class="btn btn-primary">Send Now</button>
    <button class="btn btn-secondary">Pause</button>
    <button class="btn btn-danger">Cancel</button>
  </div>
</div>
```

### Timezone Selection Modal

```html
<div class="timezone-modal">
  <h3>Select Recipient Timezone</h3>
  <select class="form-control">
    <optgroup label="North America">
      <option value="America/New_York">United States - New York (EST)</option>
      <option value="America/Los_Angeles">United States - Los Angeles (PST)</option>
      <option value="America/Toronto">Canada - Toronto (EST)</option>
    </optgroup>
    <optgroup label="Europe">
      <option value="Europe/London">United Kingdom - London (GMT)</option>
      <option value="Europe/Paris">France - Paris (CET)</option>
      <option value="Europe/Berlin">Germany - Berlin (CET)</option>
    </optgroup>
    <optgroup label="Asia">
      <option value="Asia/Kolkata">India - New Delhi (IST)</option>
      <option value="Asia/Tokyo">Japan - Tokyo (JST)</option>
      <option value="Asia/Singapore">Singapore - Singapore (SGT)</option>
    </optgroup>
  </select>
  <div class="business-hours-info">
    <p>Business Hours: 9:00 AM - 6:00 PM</p>
    <p>Weekends: Saturday, Sunday</p>
  </div>
</div>
```

## Edge Cases & Solutions

### Case 1: Timezone Not Found

**Problem**: Country code not in database

**Solution**: Use default timezone (America/New_York) and log warning

```javascript
if (!timezoneInfo) {
  console.warn(`Timezone not found for ${countryCode}, using default`);
  timezoneInfo = {
    default_timezone: 'America/New_York',
    business_hours_start: '09:00',
    business_hours_end: '18:00',
    weekend_days: ['Saturday', 'Sunday']
  };
}
```

### Case 2: Invalid Timezone String

**Problem**: IANA timezone string is invalid

**Solution**: Validate timezone and fallback to UTC

```javascript
try {
  const time = DateTime.now().setZone(timezoneString);
  if (time.invalidReason) {
    throw new Error(time.invalidReason);
  }
} catch (error) {
  console.error(`Invalid timezone: ${timezoneString}`, error);
  timezoneString = 'UTC';
}
```

### Case 3: Daylight Saving Time Transition

**Problem**: Scheduling during DST transition can cause issues

**Solution**: Use Luxon/Date-fns-tz which handles DST automatically

```javascript
// Luxon automatically handles DST
const time = DateTime.fromISO(baseTime).setZone('America/New_York');
// DST transition is handled automatically
```

### Case 4: Business Hours Span Midnight

**Problem**: Some countries have business hours that span midnight (rare)

**Solution**: Not supported in current implementation, but could be added

```javascript
// Future enhancement
if (startHour > endHour) {
  // Business hours span midnight (e.g., 22:00 - 06:00)
  // Handle as special case
}
```

## Performance Optimization

### Caching Timezone Info

```javascript
const timezoneCache = new Map();

async getTimezoneInfo(countryCode) {
  if (timezoneCache.has(countryCode)) {
    return timezoneCache.get(countryCode);
  }

  const result = await this.db.query(
    'SELECT * FROM country_timezones WHERE country_code = $1',
    [countryCode]
  );

  const info = result.rows[0] || defaultTimezone;
  timezoneCache.set(countryCode, info);
  
  // Cache expires after 1 hour
  setTimeout(() => timezoneCache.delete(countryCode), 3600000);
  
  return info;
}
```

### Batch Scheduling

```javascript
async calculateBatchSchedule(emails) {
  const schedules = await Promise.all(
    emails.map(email => this.calculateSchedule(email))
  );
  return schedules;
}
```

## Testing

### Unit Tests

```javascript
describe('TimezoneScheduler', () => {
  it('should adjust for weekend', async () => {
    const result = await scheduler.calculateSchedule({
      baseTime: '2026-04-04T09:00:00+05:30', // Saturday
      recipientCountry: 'US'
    });

    expect(result.weekend_check.is_weekend).toBe(true);
    expect(result.weekend_check.day_of_week).toBe('Monday');
  });

  it('should adjust for business hours', async () => {
    const result = await scheduler.calculateSchedule({
      baseTime: '2026-04-07T22:00:00+05:30', // 10 PM IST
      recipientCountry: 'US'
    });

    expect(result.business_hours_check.is_business_hours).toBe(false);
  });

  it('should handle multiple adjustments', async () => {
    const result = await scheduler.calculateSchedule({
      baseTime: '2026-04-06T23:00:00+05:30', // Sunday night IST
      recipientCountry: 'US'
    });

    expect(result.adjustments.length).toBeGreaterThan(0);
    expect(result.adjustments[0].type).toBe('weekend');
  });
});
```

## Monitoring & Logging

```javascript
// Log all scheduling calculations
console.log({
  type: 'schedule_calculation',
  input: { baseTime, gaps, recipientCountry },
  output: result,
  adjustments: result.adjustments.length,
  timestamp: new Date().toISOString()
});

// Track adjustment statistics
statsd.increment('schedule.adjustments.weekend', weekendAdjustments);
statsd.increment('schedule.adjustments.business_hours', businessHoursAdjustments);
statsd.timing('schedule.calculation_time', calculationTime);
```
