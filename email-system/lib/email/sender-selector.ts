/**
 * Sender Selection with Round-Robin and Rate Limiting
 * Manages sender accounts with daily/hourly limits and automatic counter reset
 */

import type {
  EmailSender,
  SenderSelectionResult,
  SenderStats,
} from './types';

// =====================================================
// SENDER SELECTOR CLASS
// =====================================================

/**
 * SenderSelector manages email sender selection with:
 * - Round-robin distribution
 * - Daily and hourly limit checking
 * - Automatic counter reset
 * - Wait time calculation when all senders at limit
 */
export class SenderSelector {
  private senders: Map<number, EmailSender>;
  private currentIndex: number;
  private lastDailyReset: string;
  private lastHourlyReset: string;

  constructor(senders: EmailSender[] = []) {
    this.senders = new Map();
    this.currentIndex = 0;

    const now = new Date();
    this.lastDailyReset = now.toDateString();
    this.lastHourlyReset = `${now.toDateString()}:${now.getHours()}`;

    // Initialize senders
    for (const sender of senders) {
      this.senders.set(sender.id, { ...sender });
    }
  }

  // =====================================================
  // PUBLIC METHODS
  // =====================================================

  /**
   * Get the next available sender using round-robin
   * Respects daily and hourly limits
   * @returns Sender selection result
   */
  getNextSender(): SenderSelectionResult {
    this.checkResets();

    const activeSenders = this.getActiveSenders();

    if (activeSenders.length === 0) {
      return {
        sender: null,
        available: false,
        reason: 'No active senders configured',
      };
    }

    // Try to find an available sender (under limits)
    let attempts = 0;
    const maxAttempts = activeSenders.length;

    while (attempts < maxAttempts) {
      const sender = activeSenders[this.currentIndex];

      // Check if sender is under limits
      const limitCheck = this.checkSenderLimits(sender);

      if (limitCheck.available) {
        // Move to next sender for round-robin
        this.currentIndex = (this.currentIndex + 1) % activeSenders.length;
        return {
          sender,
          available: true,
        };
      }

      // Sender at limit, try next
      this.currentIndex = (this.currentIndex + 1) % activeSenders.length;
      attempts++;
    }

    // All senders at limit - calculate wait time
    const waitTime = this.calculateWaitTime(activeSenders);

    return {
      sender: null,
      available: false,
      reason: 'All senders have reached their limits',
      waitTime,
    };
  }

  /**
   * Get a specific sender by ID
   */
  getSender(id: number): EmailSender | undefined {
    return this.senders.get(id);
  }

  /**
   * Get all active senders
   */
  getActiveSenders(): EmailSender[] {
    return Array.from(this.senders.values())
      .filter(s => s.isActive)
      .sort((a, b) => a.id - b.id);
  }

  /**
   * Get statistics for all senders
   */
  getSenderStats(): SenderStats[] {
    this.checkResets();

    return Array.from(this.senders.values()).map(sender => ({
      id: sender.id,
      name: sender.name,
      email: sender.email,
      sentToday: sender.sentToday,
      sentHour: sender.sentHour,
      dailyLimit: sender.dailyLimit,
      hourlyLimit: sender.hourlyLimit,
      dailyRemaining: sender.dailyLimit - sender.sentToday,
      hourlyRemaining: sender.hourlyLimit - sender.sentHour,
      isActive: sender.isActive,
      lastUsed: sender.lastUsedAt,
    }));
  }

  /**
   * Add or update a sender
   */
  setSender(sender: EmailSender): void {
    this.senders.set(sender.id, { ...sender });
  }

  /**
   * Remove a sender
   */
  removeSender(id: number): boolean {
    return this.senders.delete(id);
  }

  /**
   * Increment send count for a sender
   */
  incrementSendCount(senderId: number): void {
    const sender = this.senders.get(senderId);
    if (sender) {
      sender.sentToday++;
      sender.sentHour++;
      sender.lastUsedAt = new Date();
    }
  }

  /**
   * Check and reset daily/hourly counters if needed
   */
  checkResets(): void {
    const now = new Date();
    const today = now.toDateString();
    const currentHour = `${today}:${now.getHours()}`;

    // Reset daily counters if new day
    if (today !== this.lastDailyReset) {
      this.resetDailyCounters();
      this.lastDailyReset = today;
    }

    // Reset hourly counters if new hour
    if (currentHour !== this.lastHourlyReset) {
      this.resetHourlyCounters();
      this.lastHourlyReset = currentHour;
    }
  }

  /**
   * Manually reset daily counters for all senders
   */
  resetDailyCounters(): void {
    for (const sender of this.senders.values()) {
      sender.sentToday = 0;
      sender.lastResetDate = new Date();
    }
  }

  /**
   * Manually reset hourly counters for all senders
   */
  resetHourlyCounters(): void {
    for (const sender of this.senders.values()) {
      sender.sentHour = 0;
      sender.lastResetHour = new Date();
    }
  }

  /**
   * Calculate wait time until next available sender
   * @returns Wait time in milliseconds
   */
  calculateWaitTime(senders?: EmailSender[]): number {
    const activeSenders = senders || this.getActiveSenders();

    if (activeSenders.length === 0) {
      return 0;
    }

    // Find minimum wait time among all senders
    let minWait = Infinity;

    for (const sender of activeSenders) {
      const limitCheck = this.checkSenderLimits(sender);

      if (!limitCheck.available && limitCheck.waitTime !== undefined) {
        minWait = Math.min(minWait, limitCheck.waitTime);
      }
    }

    return minWait === Infinity ? 0 : minWait;
  }

  // =====================================================
  // PRIVATE METHODS
  // =====================================================

  /**
   * Check if a sender is under its limits
   */
  private checkSenderLimits(sender: EmailSender): {
    available: boolean;
    reason?: string;
    waitTime?: number;
  } {
    const now = new Date();

    // Check daily limit
    if (sender.sentToday >= sender.dailyLimit) {
      // Calculate time until tomorrow
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const waitTime = tomorrow.getTime() - now.getTime();

      return {
        available: false,
        reason: `Daily limit reached (${sender.sentToday}/${sender.dailyLimit})`,
        waitTime,
      };
    }

    // Check hourly limit
    if (sender.sentHour >= sender.hourlyLimit) {
      // Calculate time until next hour
      const nextHour = new Date(now);
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      const waitTime = nextHour.getTime() - now.getTime();

      return {
        available: false,
        reason: `Hourly limit reached (${sender.sentHour}/${sender.hourlyLimit})`,
        waitTime,
      };
    }

    return { available: true };
  }

  // =====================================================
  // STATIC FACTORY METHODS
  // =====================================================

  /**
   * Create SenderSelector from database records
   * @param dbSenders - Array of sender records from database
   */
  static fromDatabase(dbSenders: Array<{
    id: number;
    name: string;
    email: string;
    password?: string;
    service: string;
    smtp_host?: string;
    smtp_port?: number;
    smtp_user?: string;
    daily_limit: number;
    hourly_limit: number;
    sent_today: number;
    sent_hour?: number;
    is_active: number | boolean;
    last_reset_date?: string;
    created_at: string;
    updated_at: string;
  }>): SenderSelector {
    const senders: EmailSender[] = dbSenders.map(s => ({
      id: s.id,
      name: s.name,
      email: s.email,
      password: s.password,
      service: s.service as any,
      smtpHost: s.smtp_host,
      smtpPort: s.smtp_port,
      smtpUser: s.smtp_user,
      dailyLimit: s.daily_limit,
      hourlyLimit: s.hourly_limit,
      sentToday: s.sent_today,
      sentHour: s.sent_hour || 0,
      isActive: Boolean(s.is_active),
      lastResetDate: s.last_reset_date ? new Date(s.last_reset_date) : undefined,
      createdAt: new Date(s.created_at),
      updatedAt: new Date(s.updated_at),
    }));

    return new SenderSelector(senders);
  }

  /**
   * Create SenderSelector from environment variables (single sender)
   */
  static fromEnv(): SenderSelector {
    const email = process.env.GMAIL_USER || process.env.SMTP_USER || 'noreply@example.com';
    const service = (process.env.EMAIL_PROVIDER as any) || 'gmail';

    const sender: EmailSender = {
      id: 1,
      name: 'Default Sender',
      email,
      service,
      smtpHost: process.env.SMTP_HOST,
      smtpPort: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
      smtpUser: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD,
      dailyLimit: 500,
      hourlyLimit: 50,
      sentToday: 0,
      sentHour: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return new SenderSelector([sender]);
  }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Calculate optimal daily limit based on provider best practices
 */
export function calculateOptimalDailyLimit(
  provider: string,
  senderAge?: number // days since account creation
): number {
  const ageInDays = senderAge || 30;

  switch (provider) {
    case 'gmail':
      // Gmail has strict limits
      if (ageInDays < 7) return 50;
      if (ageInDays < 30) return 100;
      if (ageInDays < 90) return 200;
      return 500;

    case 'resend':
      // Resend: 3,000/day free tier
      return 3000;

    case 'sendgrid':
      // SendGrid: 100/day free tier
      return 100;

    case 'smtp':
      // Custom SMTP - depends on provider
      return 500;

    default:
      return 100;
  }
}

/**
 * Calculate optimal hourly limit (1/10th of daily by default)
 */
export function calculateOptimalHourlyLimit(dailyLimit: number, factor = 10): number {
  return Math.max(1, Math.floor(dailyLimit / factor));
}

/**
 * Validate sender configuration
 */
export function validateSenderConfig(sender: Partial<EmailSender>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!sender.name?.trim()) {
    errors.push('Sender name is required');
  }

  if (!sender.email?.trim()) {
    errors.push('Sender email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender.email)) {
    errors.push('Sender email is invalid');
  }

  if (sender.service === 'smtp' || sender.service === 'gmail') {
    if (!sender.password && !sender.smtpHost) {
      errors.push('Password is required for SMTP/Gmail senders');
    }
  }

  if (sender.service === 'smtp') {
    if (!sender.smtpHost) {
      errors.push('SMTP host is required for SMTP service');
    }
    if (!sender.smtpPort) {
      errors.push('SMTP port is required for SMTP service');
    }
  }

  if (sender.service === 'resend' || sender.service === 'sendgrid') {
    if (!sender.password) {
      errors.push('API key is required for this provider');
    }
  }

  if (sender.dailyLimit !== undefined && sender.dailyLimit <= 0) {
    errors.push('Daily limit must be greater than 0');
  }

  if (sender.hourlyLimit !== undefined && sender.hourlyLimit <= 0) {
    errors.push('Hourly limit must be greater than 0');
  }

  if (
    sender.dailyLimit !== undefined &&
    sender.hourlyLimit !== undefined &&
    sender.hourlyLimit > sender.dailyLimit
  ) {
    errors.push('Hourly limit cannot exceed daily limit');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format wait time for display
 */
export function formatWaitTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}
