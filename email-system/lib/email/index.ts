/**
 * Email System Library - Main Export
 * Provides email provider, sender selection, template, and validation utilities
 *
 * @module email-system/lib/email
 */

// =====================================================
// TYPE EXPORTS
// =====================================================

export type {
  // Provider types
  EmailProviderType,
  EmailProviderConfig,
  EmailMessage,
  EmailSendResult,
  EmailErrorType,
  ProviderError,

  // Sender types
  EmailSender,
  SenderSelectionResult,
  SenderStats,

  // Template types
  EmailTemplate,
  TemplateVariables,
  TemplateRenderResult,

  // Queue types
  EmailQueueItem,
  QueueProcessingOptions,

  // Validation types
  EmailValidationResult,
  DomainReputation,

  // Timezone types
  CountryTimezoneConfig,
  BusinessHoursStatus,

  // Campaign types
  EmailCampaign,

  // Send log types
  EmailSendLog,
} from './types';

// Export error classes
export {
  EmailSystemError,
  EmailProviderError,
  SenderLimitError,
  TemplateError,
  ValidationError,
} from './types';

// =====================================================
// PROVIDER EXPORTS
// =====================================================

export {
  // Base provider
  EmailProvider,

  // Provider implementations
  ResendProvider,
  SendGridProvider,
  SMTPProvider,

  // Factory
  EmailProviderFactory,

  // Helpers
  createProviderFromEnv,
  testProvider,
} from './provider';

// =====================================================
// SENDER SELECTOR EXPORTS
// =====================================================

export {
  SenderSelector,
  calculateOptimalDailyLimit,
  calculateOptimalHourlyLimit,
  validateSenderConfig,
  formatWaitTime,
} from './sender-selector';

// =====================================================
// TEMPLATE ENGINE EXPORTS
// =====================================================

export {
  TemplateEngine,
  TemplateBuilder,
  createTemplate,
  templateEngine,

  // Template helpers
  extractCompanyFromUrl,
  formatCompanyName,
  createGreeting,
  sanitizeHtml,
  previewTemplate,
  getVariableSuggestions,

  // Predefined templates
  getBasicOutreachTemplate,
  getFollowUpTemplate,
} from './templates';

// =====================================================
// VALIDATION EXPORTS
// =====================================================

export {
  validateEmail,
  normalizeEmail,
  extractDomain,
  extractNameFromEmail,
  extractFullNameFromEmail,
  isDisposableEmail,
  isFreeEmail,
  isRoleEmail,
  getDomainReputation,
  validateEmailList,
  filterValidEmails,
  getEmailValidationStats,
  isValidEmailFormat,
  sanitizeEmail,
} from './validation';

// =====================================================
// RE-EXPORT CONSTANTS FROM VALIDATION
// =====================================================

export {
  DISPOSABLE_DOMAINS,
  FREE_PROVIDERS,
  ROLE_PREFIXES,
} from './validation';

// =====================================================
// CONVENIENCE EXPORTS
// =====================================================

/**
 * Create a complete email system instance
 * Useful for quick setup
 */
export function createEmailSystem(config?: {
  resendApiKey?: string;
  sendgridApiKey?: string;
  smtp?: {
    host: string;
    port: number;
    user?: string;
    password?: string;
  };
  senders?: Array<{
    id: number;
    name: string;
    email: string;
    password?: string;
    service: EmailProviderType;
    dailyLimit: number;
    hourlyLimit: number;
  }>;
}) {
  const {
    SenderSelector,
  } = require('./sender-selector');
  const {
    EmailProviderFactory,
  } = require('./provider');

  const selector = new SenderSelector(config?.senders || []);

  return {
    selector,
    templateEngine: require('./templates').templateEngine,
    getProvider: (type: EmailProviderType, providerConfig?: any) =>
      EmailProviderFactory.getProvider({
        type,
        apiKey: type === 'resend' ? config?.resendApiKey : type === 'sendgrid' ? config?.sendgridApiKey : undefined,
        ...providerConfig,
      }),
  };
}
