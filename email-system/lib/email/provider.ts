/**
 * Email Provider Abstraction Layer
 * Supports multiple email providers with unified interface
 */

import type {
  EmailProviderType,
  EmailProviderConfig,
  EmailMessage,
  EmailSendResult,
  EmailErrorType,
  ProviderError,
} from './types';

// =====================================================
// BASE PROVIDER INTERFACE
// =====================================================

/**
 * Abstract base class for email providers
 */
export abstract class EmailProvider {
  protected config: EmailProviderConfig;
  protected rateLimit: {
    tokens: number;
    lastRefill: number;
  };

  constructor(config: EmailProviderConfig) {
    this.config = config;
    this.rateLimit = {
      tokens: config.rateLimitPerSecond || 10,
      lastRefill: Date.now(),
    };
  }

  /**
   * Send an email
   * @param message - Email message to send
   * @returns Send result
   */
  abstract send(message: EmailMessage): Promise<EmailSendResult>;

  /**
   * Check if provider is healthy
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Get provider type
   */
  getType(): EmailProviderType {
    return this.config.type;
  }

  /**
   * Rate limiting check
   */
  protected async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.rateLimit.lastRefill;
    const limitPerSecond = this.config.rateLimitPerSecond || 10;

    // Refill tokens based on elapsed time
    this.rateLimit.tokens = Math.min(
      limitPerSecond,
      this.rateLimit.tokens + (elapsed / 1000) * limitPerSecond
    );
    this.rateLimit.lastRefill = now;

    // If no tokens available, wait
    if (this.rateLimit.tokens < 1) {
      const waitTime = (1 - this.rateLimit.tokens) * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.rateLimit.tokens = 0;
    } else {
      this.rateLimit.tokens -= 1;
    }
  }

  /**
   * Classify error type from error message/status code
   */
  protected classifyError(error: Error | string, statusCode?: number): EmailErrorType {
    const message = typeof error === 'string' ? error : error.message;
    const lowerMessage = message.toLowerCase();

    // Rate limiting
    if (
      lowerMessage.includes('rate limit') ||
      lowerMessage.includes('too many requests') ||
      lowerMessage.includes('throttled') ||
      statusCode === 429
    ) {
      return 'rate_limit';
    }

    // Authentication errors
    if (
      lowerMessage.includes('auth') ||
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('invalid api key') ||
      statusCode === 401
    ) {
      return 'auth';
    }

    // Permanent failures
    if (
      lowerMessage.includes('invalid email') ||
      lowerMessage.includes('does not exist') ||
      lowerMessage.includes('rejected') ||
      lowerMessage.includes('blocked') ||
      lowerMessage.includes('spam') ||
      statusCode === 400
    ) {
      return 'permanent';
    }

    // Network errors
    if (
      lowerMessage.includes('network') ||
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('enotfound')
    ) {
      return 'network';
    }

    // Default to temporary for retry
    return 'temporary';
  }

  /**
   * Create provider error
   */
  protected createError(
    error: Error | string,
    statusCode?: number,
    details?: Record<string, unknown>
  ): ProviderError {
    const message = typeof error === 'string' ? error : error.message;
    const type = this.classifyError(message, statusCode);
    const retryable = type !== 'permanent' && type !== 'auth';

    const providerError = new Error(message) as ProviderError;
    providerError.type = type;
    providerError.statusCode = statusCode;
    providerError.retryable = retryable;
    providerError.details = details;

    return providerError;
  }
}

// =====================================================
// RESEND PROVIDER
// =====================================================

/**
 * Resend email provider implementation
 * @see https://resend.com/docs/api-reference/emails/send
 */
export class ResendProvider extends EmailProvider {
  private baseUrl = 'https://api.resend.com/emails';

  constructor(config: EmailProviderConfig) {
    super({ ...config, type: 'resend' });
    if (!config.apiKey) {
      throw new Error('Resend API key is required');
    }
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    await this.checkRateLimit();

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          reply_to: message.replyTo,
          tags: message.tags
            ? Object.entries(message.tags).map(([name, value]) => ({ name, value }))
            : undefined,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const error = this.createError(
          data?.error?.message || data?.message || 'Resend API error',
          response.status,
          { response: data }
        );
        return {
          success: false,
          error: error.message,
          errorType: error.type,
          statusCode: response.status,
          retryable: error.retryable,
          rawResponse: data,
        };
      }

      return {
        success: true,
        messageId: data?.id,
        providerMessageId: data?.id,
        rawResponse: data,
      };
    } catch (error) {
      const providerError = this.createError(error as Error);
      return {
        success: false,
        error: providerError.message,
        errorType: providerError.type,
        retryable: providerError.retryable,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });
      return response.status < 500;
    } catch {
      return false;
    }
  }
}

// =====================================================
// SENDGRID PROVIDER
// =====================================================

/**
 * SendGrid email provider implementation
 * @see https://docs.sendgrid.com/api-reference/mail-send/mail-send
 */
export class SendGridProvider extends EmailProvider {
  private baseUrl = 'https://api.sendgrid.com/v3/mail/send';

  constructor(config: EmailProviderConfig) {
    super({ ...config, type: 'sendgrid' });
    if (!config.apiKey) {
      throw new Error('SendGrid API key is required');
    }
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    await this.checkRateLimit();

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email: message.to, name: message.toName || '' }],
              subject: message.subject,
            },
          ],
          from: { email: message.from, name: message.fromName || '' },
          reply_to: message.replyTo ? { email: message.replyTo } : undefined,
          content: [
            {
              type: 'text/html',
              value: message.html,
            },
            ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
          ],
          custom_args: message.tags,
        }),
      });

      const messageId = response.headers.get('X-Message-Id');

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = await response.text();
        }

        const errorMessage =
          typeof errorData === 'object'
            ? errorData?.errors?.[0]?.message || errorData?.message || 'SendGrid API error'
            : 'SendGrid API error';

        const error = this.createError(errorMessage, response.status, { response: errorData });
        return {
          success: false,
          error: error.message,
          errorType: error.type,
          statusCode: response.status,
          retryable: error.retryable,
          rawResponse: errorData,
        };
      }

      // SendGrid returns 202 Accepted on success
      return {
        success: true,
        messageId: messageId || undefined,
        providerMessageId: messageId,
      };
    } catch (error) {
      const providerError = this.createError(error as Error);
      return {
        success: false,
        error: providerError.message,
        errorType: providerError.type,
        retryable: providerError.retryable,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/user/profile', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// =====================================================
// SMTP PROVIDER
// =====================================================

/**
 * SMTP email provider implementation
 * Falls back to nodemailer for SMTP sending
 * Note: This requires Node.js runtime
 */
export class SMTPProvider extends EmailProvider {
  private transporter: any = null;

  constructor(config: EmailProviderConfig) {
    super({ ...config, type: 'smtp' });
    if (!config.host || !config.port) {
      throw new Error('SMTP host and port are required');
    }
  }

  private async getTransporter() {
    if (this.transporter) return this.transporter;

    // Dynamic import for nodemailer
    try {
      const nodemailer = await import('nodemailer');

      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure || this.config.port === 465,
        auth: {
          user: this.config.user || this.config.apiKey,
          pass: this.config.password,
        },
      });

      return this.transporter;
    } catch (error) {
      throw new Error(`Failed to load nodemailer: ${error}`);
    }
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    await this.checkRateLimit();

    try {
      const transporter = await this.getTransporter();

      const mailOptions = {
        from: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      };

      const info = await transporter.sendMail(mailOptions);

      return {
        success: true,
        messageId: info.messageId,
        providerMessageId: info.messageId,
      };
    } catch (error) {
      const err = error as Error & { code?: string; responseCode?: number };
      const statusCode = err.responseCode || undefined;
      const providerError = this.createError(err, statusCode);

      return {
        success: false,
        error: providerError.message,
        errorType: providerError.type,
        statusCode: providerError.statusCode,
        retryable: providerError.retryable,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const transporter = await this.getTransporter();
      await transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}

// =====================================================
// PROVIDER FACTORY
// =====================================================

/**
 * Provider factory - creates provider instances based on type
 */
export class EmailProviderFactory {
  private static providers = new Map<string, EmailProvider>();

  /**
   * Get or create a provider instance
   */
  static getProvider(config: EmailProviderConfig): EmailProvider {
    const key = `${config.type}:${config.apiKey || config.host}:${config.port || ''}`;

    if (!this.providers.has(key)) {
      const provider = this.createProvider(config);
      this.providers.set(key, provider);
    }

    return this.providers.get(key)!;
  }

  /**
   * Create a new provider instance
   */
  private static createProvider(config: EmailProviderConfig): EmailProvider {
    switch (config.type) {
      case 'resend':
        return new ResendProvider(config);
      case 'sendgrid':
        return new SendGridProvider(config);
      case 'smtp':
      case 'gmail':
        return new SMTPProvider(config);
      default:
        throw new Error(`Unsupported provider type: ${config.type}`);
    }
  }

  /**
   * Clear cached providers
   */
  static clearCache(): void {
    this.providers.clear();
  }

  /**
   * Create provider from sender config
   */
  static fromSenderConfig(sender: {
    service: EmailProviderType;
    apiKey?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    password?: string;
  }): EmailProvider {
    const config: EmailProviderConfig = {
      type: sender.service,
      apiKey: sender.apiKey,
      host: sender.smtpHost,
      port: sender.smtpPort,
      user: sender.smtpUser,
      password: sender.password,
    };

    return this.getProvider(config);
  }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Create provider config from environment variables
 */
export function createProviderFromEnv(): EmailProvider {
  const type = (process.env.EMAIL_PROVIDER as EmailProviderType) || 'smtp';
  const apiKey = process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY;

  return EmailProviderFactory.getProvider({
    type,
    apiKey,
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || process.env.GMAIL_USER,
    password: process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD,
  });
}

/**
 * Test a provider configuration
 */
export async function testProvider(config: EmailProviderConfig): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const provider = EmailProviderFactory.getProvider(config);
    const isHealthy = await provider.healthCheck();

    if (!isHealthy) {
      return {
        success: false,
        error: 'Provider health check failed',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
