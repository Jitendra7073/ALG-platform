/**
 * Email Validation Utilities
 * Provides email validation, normalization, and domain analysis
 */

import type {
  EmailValidationResult,
  DomainReputation,
} from './types';

// =====================================================
// CONSTANTS
// =====================================================

/**
 * Common disposable email domains
 */
const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com',
  'guerrillamail.com',
  'mailinator.com',
  '10minutemail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'getnada.com',
  'throwaway.email',
  'fakeinbox.com',
  'maildrop.cc',
  'temp-mail.org',
  'throwawaymail.com',
]);

/**
 * Common free email providers
 */
const FREE_PROVIDERS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'protonmail.com',
  'tutanota.com',
  'zoho.com',
  'yandex.com',
  'mail.com',
]);

/**
 * Role-based email prefixes
 */
const ROLE_PREFIXES = new Set([
  'admin',
  'administrator',
  'info',
  'support',
  'sales',
  'contact',
  'office',
  'help',
  'enquiries',
  'billing',
  'accounts',
  'finance',
  'hr',
  'jobs',
  'careers',
  'marketing',
  'webmaster',
  'postmaster',
  'hostmaster',
  'abuse',
  'noreply',
  'no-reply',
]);

/**
 * Regex for basic email validation
 * RFC 5322 compliant simplified version
 */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Strict regex for more thorough validation
 */
const STRICT_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// =====================================================
// VALIDATION FUNCTIONS
// =====================================================

/**
 * Validate an email address
 * @param email - Email address to validate
 * @param options - Validation options
 * @returns Validation result with details
 */
export function validateEmail(
  email: string,
  options: {
    checkDisposable?: boolean;
    checkRole?: boolean;
    strict?: boolean;
    normalize?: boolean;
  } = {}
): EmailValidationResult {
  const {
    checkDisposable = true,
    checkRole = true,
    strict = false,
    normalize = true,
  } = options;

  const warnings: string[] = [];

  // Trim whitespace
  let trimmedEmail = email.trim();

  // Lowercase for validation
  const normalizedEmail = trimmedEmail.toLowerCase();

  // Basic format check
  const regex = strict ? STRICT_EMAIL_REGEX : EMAIL_REGEX;
  if (!regex.test(normalizedEmail)) {
    return {
      valid: false,
      email: trimmedEmail,
      error: 'Invalid email format',
    };
  }

  // Split into local part and domain
  const atIndex = normalizedEmail.lastIndexOf('@');
  const localPart = normalizedEmail.slice(0, atIndex);
  const domain = normalizedEmail.slice(atIndex + 1);

  // Check local part length
  if (localPart.length === 0) {
    return {
      valid: false,
      email: trimmedEmail,
      error: 'Email local part is empty',
    };
  }

  if (localPart.length > 64) {
    return {
      valid: false,
      email: trimmedEmail,
      error: 'Email local part exceeds 64 characters',
    };
  }

  // Check domain length
  if (domain.length > 255) {
    return {
      valid: false,
      email: trimmedEmail,
      error: 'Email domain exceeds 255 characters',
    };
  }

  // Check for consecutive dots
  if (localPart.includes('..') || domain.includes('..')) {
    return {
      valid: false,
      email: trimmedEmail,
      error: 'Email contains consecutive dots',
    };
  }

  // Check for leading/trailing dots
  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    return {
      valid: false,
      email: trimmedEmail,
      error: 'Email local part starts or ends with a dot',
    };
  }

  // Check for leading dash in domain labels
  if (domain.includes('-.') || domain.startsWith('-') || domain.endsWith('-')) {
    return {
      valid: false,
      email: trimmedEmail,
      error: 'Email domain contains invalid dash placement',
    };
  }

  // Determine email type
  let type: EmailValidationResult['type'] = 'unknown';

  // Check for disposable domain
  const isDisposable = DISPOSABLE_DOMAINS.has(domain);
  if (isDisposable) {
    type = 'disposable';
    warnings.push('Disposable email domain detected');
  }

  // Check for free provider
  const isFreeProvider = FREE_PROVIDERS.has(domain);
  if (isFreeProvider && !isDisposable) {
    type = 'personal';
    warnings.push('Free email provider detected');
  }

  // Check for role-based address
  const rolePrefix = localPart.split('+')[0]; // Handle sub-addressing
  const isRole = ROLE_PREFIXES.has(rolePrefix.toLowerCase());
  if (isRole && checkRole) {
    type = 'role';
    warnings.push('Role-based email address detected');
  }

  // Professional email (company domain)
  if (!isDisposable && !isFreeProvider && !isRole) {
    type = 'professional';
  }

  return {
    valid: true,
    email: trimmedEmail,
    normalized: normalize ? normalizedEmail : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    type,
    domain,
  };
}

/**
 * Normalize an email address
 * @param email - Email address to normalize
 * @returns Normalized email address
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Extract domain from email address
 * @param email - Email address
 * @returns Domain part of email
 */
export function extractDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex === -1) return null;
  return normalized.slice(atIndex + 1);
}

/**
 * Extract name from email address (local part)
 * Handles common patterns like john.doe -> John Doe
 * @param email - Email address
 * @returns Extracted name or null
 */
export function extractNameFromEmail(email: string): string | null {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex === -1) return null;

  const localPart = normalized.slice(0, atIndex);

  // Remove common patterns
  let namePart = localPart
    .split('+')[0] // Remove sub-addressing
    .split('.')[0] // Use first part of dot-separated names
    .split('_')[0]; // Use first part of underscore-separated names

  // Capitalize first letter
  if (namePart.length > 0) {
    return namePart.charAt(0).toUpperCase() + namePart.slice(1);
  }

  return null;
}

/**
 * Extract full name from email address
 * Handles patterns like john.doe, john_doe, john-doe -> John Doe
 * @param email - Email address
 * @returns Extracted full name or null
 */
export function extractFullNameFromEmail(email: string): string | null {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex === -1) return null;

  const localPart = normalized.slice(0, atIndex).split('+')[0];

  // Try different separators
  const separators = ['.', '_', '-'];
  let parts: string[] = [];

  for (const sep of separators) {
    if (localPart.includes(sep)) {
      parts = localPart.split(sep);
      break;
    }
  }

  // If no separator found, treat as single name
  if (parts.length === 0) {
    parts = [localPart];
  }

  // Capitalize each part
  const nameParts = parts
    .filter(p => p.length > 0)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());

  if (nameParts.length === 0) return null;

  return nameParts.join(' ');
}

/**
 * Check if email is from a disposable domain
 * @param email - Email address
 * @returns True if disposable domain
 */
export function isDisposableEmail(email: string): boolean {
  const domain = extractDomain(email);
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}

/**
 * Check if email is from a free provider
 * @param email - Email address
 * @returns True if free provider
 */
export function isFreeEmail(email: string): boolean {
  const domain = extractDomain(email);
  if (!domain) return false;
  return FREE_PROVIDERS.has(domain.toLowerCase());
}

/**
 * Check if email is a role-based address
 * @param email - Email address
 * @returns True if role-based address
 */
export function isRoleEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex === -1) return false;

  const localPart = normalized.slice(0, atIndex).split('+')[0];
  return ROLE_PREFIXES.has(localPart.toLowerCase());
}

/**
 * Get domain reputation information
 * @param domain - Domain to check
 * @returns Domain reputation data
 */
export function getDomainReputation(domain: string): DomainReputation {
  const normalizedDomain = domain.toLowerCase();
  const isDisposable = DISPOSABLE_DOMAINS.has(normalizedDomain);
  const isFreeProvider = FREE_PROVIDERS.has(normalizedDomain);
  const isRoleAddress = false; // Role check depends on email, not domain

  let score = 100;
  let riskLevel: DomainReputation['riskLevel'] = 'low';

  if (isDisposable) {
    score = 0;
    riskLevel = 'high';
  } else if (isFreeProvider) {
    score = 50;
    riskLevel = 'medium';
  }

  return {
    domain: normalizedDomain,
    score,
    isDisposable,
    isFreeProvider,
    isRoleAddress,
    riskLevel,
  };
}

/**
 * Validate a list of emails
 * @param emails - Array of email addresses
 * @param options - Validation options
 * @returns Array of validation results
 */
export function validateEmailList(
  emails: string[],
  options?: Parameters<typeof validateEmail>[1]
): EmailValidationResult[] {
  return emails.map(email => validateEmail(email, options));
}

/**
 * Filter valid emails from a list
 * @param emails - Array of email addresses
 * @param options - Validation options
 * @returns Array of valid, normalized emails
 */
export function filterValidEmails(
  emails: string[],
  options?: Parameters<typeof validateEmail>[1]
): string[] {
  const results = validateEmailList(emails, options);
  return results
    .filter(r => r.valid)
    .map(r => r.normalized || r.email);
}

/**
 * Batch validate emails and return statistics
 * @param emails - Array of email addresses
 * @returns Validation statistics
 */
export function getEmailValidationStats(emails: string[]) {
  const results = validateEmailList(emails);
  const stats = {
    total: emails.length,
    valid: 0,
    invalid: 0,
    disposable: 0,
    free: 0,
    role: 0,
    professional: 0,
    warnings: 0,
  };

  for (const result of results) {
    if (result.valid) {
      stats.valid++;
      stats.warnings += result.warnings?.length || 0;

      if (result.type === 'disposable') stats.disposable++;
      else if (result.type === 'personal') stats.free++;
      else if (result.type === 'role') stats.role++;
      else if (result.type === 'professional') stats.professional++;
    } else {
      stats.invalid++;
    }
  }

  return stats;
}

/**
 * Check if email format is valid (quick check)
 * @param email - Email address
 * @returns True if format is valid
 */
export function isValidEmailFormat(email: string): boolean {
  try {
    return EMAIL_REGEX.test(email.trim().toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Sanitize email for storage/log output
 * Masks part of the email for privacy
 * @param email - Email address
 * @param maskChar - Character to use for masking (default: *)
 * @returns Sanitized email
 */
export function sanitizeEmail(email: string, maskChar = '*'): string {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');

  if (atIndex === -1) return normalized;

  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex);

  // Show first 2 and last 2 characters of local part
  if (localPart.length <= 4) {
    return maskChar.repeat(localPart.length) + domain;
  }

  return (
    localPart.slice(0, 2) +
    maskChar.repeat(localPart.length - 4) +
    localPart.slice(-2) +
    domain
  );
}
