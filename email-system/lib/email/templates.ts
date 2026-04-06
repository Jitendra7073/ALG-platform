/**
 * Template Engine with Variable Replacement
 * Supports dynamic variable substitution in email templates
 */

import type {
  EmailTemplate,
  TemplateVariables,
  TemplateRenderResult,
} from './types';
import {
  extractNameFromEmail,
  extractFullNameFromEmail,
  extractDomain,
} from './validation';

// =====================================================
// TEMPLATE ENGINE CLASS
// =====================================================

/**
 * TemplateEngine handles variable replacement in email templates
 * Supports Mustache-style {{variable}} syntax
 */
export class TemplateEngine {
  private variableRegex = /\{\{([^}]+)\}\}/g;

  /**
   * Render a template with provided variables
   * @param template - Template to render
   * @param variables - Variables for substitution
   * @returns Rendered result
   */
  render(
    template: Pick<EmailTemplate, 'subject' | 'htmlContent' | 'textContent'>,
    variables: TemplateVariables
  ): TemplateRenderResult {
    const errors: string[] = [];

    // Render subject
    const subject = this.replaceVariables(template.subject, variables, errors);

    // Render HTML content
    const html = this.replaceVariables(template.htmlContent, variables, errors);

    // Render text content if present
    let text: string | undefined;
    if (template.textContent) {
      text = this.replaceVariables(template.textContent, variables, errors);
    }

    return {
      subject,
      html,
      text,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Render template with context extraction
   * Automatically extracts name from email, company from URL
   */
  renderWithContext(
    template: Pick<EmailTemplate, 'subject' | 'htmlContent' | 'textContent'>,
    context: {
      email?: string;
      url?: string;
      senderName?: string;
      senderEmail?: string;
      campaignName?: string;
      [key: string]: string | number | boolean | undefined;
    }
  ): TemplateRenderResult {
    const variables: TemplateVariables = { ...context };

    // Auto-extract name from email if not provided
    if (!variables.name && variables.email) {
      const fullName = extractFullNameFromEmail(variables.email);
      if (fullName) {
        variables.name = fullName;
      } else {
        const firstName = extractNameFromEmail(variables.email);
        if (firstName) {
          variables.name = firstName;
        }
      }
    }

    // Auto-extract company from URL if not provided
    if (!variables.company && variables.url) {
      variables.company = extractCompanyFromUrl(variables.url);
    }

    // Auto-extract domain from URL
    if (!variables.domain && variables.url) {
      try {
        const urlObj = new URL(variables.url);
        variables.domain = urlObj.hostname;
      } catch {
        // Invalid URL, skip
      }
    }

    return this.render(template, variables);
  }

  /**
   * Replace variables in a string
   */
  private replaceVariables(
    content: string,
    variables: TemplateVariables,
    errors: string[]
  ): string {
    return content.replace(this.variableRegex, (match, variablePath) => {
      const trimmedPath = variablePath.trim();
      const value = this.getNestedValue(variables, trimmedPath);

      if (value === undefined) {
        // Track missing variable
        const error = `Missing variable: {{${trimmedPath}}}`;
        if (!errors.includes(error)) {
          errors.push(error);
        }
        return match; // Keep original placeholder
      }

      return String(value);
    });
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: TemplateVariables, path: string): string | number | boolean | undefined {
    const parts = path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Generate HTML preview of rendered template
   */
  generatePreview(renderResult: TemplateRenderResult): string {
    const { html } = renderResult;

    // Wrap in iframe-friendly container
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
    .preview-container { max-width: 600px; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="preview-container">
    ${html}
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Extract all variable names from a template
   */
  extractVariables(template: Pick<EmailTemplate, 'subject' | 'htmlContent' | 'textContent'>): Set<string> {
    const variables = new Set<string>();

    const extractFrom = (content: string) => {
      let match;
      while ((match = this.variableRegex.exec(content)) !== null) {
        variables.add(match[1].trim());
      }
      // Reset regex for next string
      this.variableRegex.lastIndex = 0;
    };

    extractFrom(template.subject);
    extractFrom(template.htmlContent);
    if (template.textContent) {
      extractFrom(template.textContent);
    }

    return variables;
  }

  /**
   * Validate template has all required variables
   */
  validateRequiredVariables(
    template: Pick<EmailTemplate, 'subject' | 'htmlContent' | 'textContent'>,
    requiredVariables: string[]
  ): { valid: boolean; missing: string[] } {
    const templateVars = this.extractVariables(template);
    const missing: string[] = [];

    for (const required of requiredVariables) {
      if (!templateVars.has(required)) {
        missing.push(required);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Extract company name from URL
 * Handles various URL formats and TLDs
 */
export function extractCompanyFromUrl(url: string): string {
  try {
    // Ensure URL has protocol
    let urlStr = url;
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
      urlStr = 'https://' + urlStr;
    }

    const urlObj = new URL(urlStr);
    let hostname = urlObj.hostname;

    // Remove www. prefix
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }

    // Remove public suffixes (TLDs)
    const parts = hostname.split('.');

    // Handle common patterns
    if (parts.length >= 2) {
      // For domains like company.co.uk, get the first part
      if (parts.length >= 3 && parts[parts.length - 1] === 'uk' && parts[parts.length - 2] === 'co') {
        return parts[parts.length - 3];
      }

      // For regular domains, get the first part
      return parts[0];
    }

    return hostname;
  } catch {
    // If URL parsing fails, try to extract from string
    const withoutProtocol = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
    const firstPart = withoutProtocol.split('/')[0].split('.')[0];
    return firstPart;
  }
}

/**
 * Format company name for display
 * Capitalizes first letter, replaces hyphens/underscores with spaces
 */
export function formatCompanyName(name: string): string {
  return name
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Create a default greeting based on name
 */
export function createGreeting(name?: string): string {
  if (!name || name.trim() === '') {
    return 'Hi there,';
  }

  const trimmed = name.trim();

  // Check if it's a full name (contains space)
  if (trimmed.includes(' ')) {
    const firstName = trimmed.split(' ')[0];
    return `Hi ${firstName},`;
  }

  return `Hi ${trimmed},`;
}

/**
 * Sanitize HTML content to prevent XSS
 * Basic sanitization for trusted templates
 */
export function sanitizeHtml(html: string): string {
  // Remove script tags and their content
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');

  return sanitized;
}

/**
 * Preview template with sample data
 */
export function previewTemplate(
  template: Pick<EmailTemplate, 'subject' | 'htmlContent' | 'textContent'>,
  sampleData?: TemplateVariables
): TemplateRenderResult {
  const engine = new TemplateEngine();

  const defaultSample: TemplateVariables = {
    name: 'John',
    email: 'john.doe@company.com',
    company: 'TechCorp',
    url: 'https://techcorp.com',
    domain: 'techcorp.com',
    sender_name: 'Your Name',
    sender_email: 'your@email.com',
    campaign_name: 'Outreach Campaign',
    ...sampleData,
  };

  return engine.renderWithContext(template, defaultSample);
}

/**
 * Get variable suggestions based on template content
 */
export function getVariableSuggestions(
  partial: string,
  template?: Pick<EmailTemplate, 'subject' | 'htmlContent' | 'textContent'>
): string[] {
  const commonVariables = [
    'name',
    'email',
    'company',
    'url',
    'domain',
    'sender_name',
    'sender_email',
    'campaign_name',
    'first_name',
    'last_name',
    'title',
    'phone',
  ];

  if (!partial) {
    return commonVariables;
  }

  const lowerPartial = partial.toLowerCase();
  return commonVariables.filter(v => v.toLowerCase().includes(lowerPartial));
}

// =====================================================
// TEMPLATE BUILDER
// =====================================================

/**
 * Helper class for building email templates
 */
export class TemplateBuilder {
  private template: Partial<EmailTemplate> = {
    isActive: true,
    sequenceNumber: 0,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  /**
   * Set template name
   */
  name(name: string): this {
    this.template.name = name;
    return this;
  }

  /**
   * Set subject
   */
  subject(subject: string): this {
    this.template.subject = subject;
    return this;
  }

  /**
   * Set HTML content
   */
  html(html: string): this {
    this.template.htmlContent = html;
    return this;
  }

  /**
   * Set text content
   */
  text(text: string): this {
    this.template.textContent = text;
    return this;
  }

  /**
   * Set category
   */
  category(category: string): this {
    this.template.category = category;
    return this;
  }

  /**
   * Add tag
   */
  tag(tag: string): this {
    if (!this.template.tags) {
      this.template.tags = [];
    }
    this.template.tags.push(tag);
    return this;
  }

  /**
   * Set sequence number
   */
  sequence(number: number): this {
    this.template.sequenceNumber = number;
    return this;
  }

  /**
   * Set description
   */
  description(desc: string): this {
    this.template.description = desc;
    return this;
  }

  /**
   * Build the template
   */
  build(): EmailTemplate {
    if (!this.template.name || !this.template.subject || !this.template.htmlContent) {
      throw new Error('Template must have name, subject, and htmlContent');
    }

    return {
      id: 0, // Will be set by database
      name: this.template.name,
      subject: this.template.subject,
      htmlContent: this.template.htmlContent,
      textContent: this.template.textContent,
      description: this.template.description,
      category: this.template.category || 'general',
      tags: this.template.tags || [],
      sequenceNumber: this.template.sequenceNumber || 0,
      isActive: this.template.isActive ?? true,
      version: 1,
      createdAt: this.template.createdAt || new Date(),
      updatedAt: this.template.updatedAt || new Date(),
    };
  }
}

/**
 * Create a new template builder
 */
export function createTemplate(): TemplateBuilder {
  return new TemplateBuilder();
}

// =====================================================
// PREDEFINED TEMPLATES
// =====================================================

/**
 * Get a basic outreach template
 */
export function getBasicOutreachTemplate(): Pick<EmailTemplate, 'subject' | 'htmlContent' | 'textContent'> {
  return {
    subject: 'Quick Question',
    htmlContent: `
<p>Hi {{name}},</p>

<p>I hope this email finds you well. I came across {{company}} and noticed some interesting things about what you're doing.</p>

<p>I'd love to learn more about your current setup and see if there might be an opportunity for us to work together.</p>

<p>Would you be open to a quick chat this week?</p>

<p>Best regards,<br>
{{sender_name}}</p>
    `.trim(),
    textContent: `
Hi {{name}},

I hope this email finds you well. I came across {{company}} and noticed some interesting things about what you're doing.

I'd love to learn more about your current setup and see if there might be an opportunity for us to work together.

Would you be open to a quick chat this week?

Best regards,
{{sender_name}}
    `.trim(),
  };
}

/**
 * Get a follow-up template
 */
export function getFollowUpTemplate(): Pick<EmailTemplate, 'subject' | 'htmlContent' | 'textContent'> {
  return {
    subject: 'Re: Quick Question',
    htmlContent: `
<p>Hi {{name}},</p>

<p>I wanted to follow up on my previous email. I know you're busy, but I wanted to see if you had a chance to think about what we discussed.</p>

<p>I'd be happy to share some ideas that might be relevant to {{company}}.</p>

<p>Let me know if you have some time this week.</p>

<p>Best regards,<br>
{{sender_name}}</p>
    `.trim(),
    textContent: `
Hi {{name}},

I wanted to follow up on my previous email. I know you're busy, but I wanted to see if you had a chance to think about what we discussed.

I'd be happy to share some ideas that might be relevant to {{company}}.

Let me know if you have some time this week.

Best regards,
{{sender_name}}
    `.trim(),
  };
}

// Export singleton instance
export const templateEngine = new TemplateEngine();
