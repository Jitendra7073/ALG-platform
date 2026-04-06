# Email System Library

A comprehensive email provider, sender selection, template engine, and validation library for Node.js/TypeScript applications.

## Features

- **Multiple Provider Support**: Resend, SendGrid, SMTP (Gmail)
- **Sender Selection**: Round-robin with daily/hourly limit checking
- **Template Engine**: Variable replacement with `{{variable}}` syntax
- **Email Validation**: Format checking, disposable detection, role address detection
- **Type-Safe**: Full TypeScript support

## Installation

```bash
npm install nodemailer
```

## Quick Start

```typescript
import {
  SenderSelector,
  EmailProviderFactory,
  templateEngine,
  validateEmail
} from './lib/email';

// Setup sender selector
const selector = new SenderSelector([{
  id: 1,
  name: 'Gmail Account',
  email: 'your@gmail.com',
  password: 'app-password',
  service: 'gmail',
  dailyLimit: 500,
  hourlyLimit: 50,
  sentToday: 0,
  sentHour: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}]);

// Get next available sender
const result = selector.getNextSender();
if (result.available) {
  const sender = result.sender!;

  // Create provider
  const provider = EmailProviderFactory.fromSenderConfig(sender);

  // Render template
  const rendered = templateEngine.renderWithContext(
    {
      subject: 'Hello {{name}}',
      htmlContent: '<p>Hi {{name}}, from {{company}}</p>',
    },
    { email: 'john@techcorp.com', url: 'https://techcorp.com' }
  );

  // Send email
  const sendResult = await provider.send({
    to: 'recipient@example.com',
    from: sender.email,
    subject: rendered.subject,
    html: rendered.html,
  });
}
```

## Modules

### Provider (`provider.ts`)

Abstract email provider interface with implementations for:

- **ResendProvider**: Resend.com API
- **SendGridProvider**: SendGrid API
- **SMTPProvider**: SMTP/Gmail via nodemailer

```typescript
import { EmailProviderFactory } from './lib/email/provider';

// Create provider
const provider = EmailProviderFactory.getProvider({
  type: 'resend',
  apiKey: process.env.RESEND_API_KEY,
});

// Send email
const result = await provider.send({
  to: 'user@example.com',
  from: 'sender@example.com',
  subject: 'Hello',
  html: '<p>World</p>',
});
```

### Sender Selector (`sender-selector.ts`)

Manages sender accounts with round-robin selection and rate limiting:

```typescript
import { SenderSelector } from './lib/email/sender-selector';

const selector = new SenderSelector(senders);

// Get next sender
const { sender, available, reason, waitTime } = selector.getNextSender();

// Increment after sending
selector.incrementSendCount(sender.id);

// Get stats
const stats = selector.getSenderStats();
```

### Templates (`templates.ts`)

Template engine with variable replacement:

```typescript
import { templateEngine, createGreeting } from './lib/email/templates';

// Render with context
const rendered = templateEngine.renderWithContext(
  {
    subject: 'Quick question for {{name}}',
    htmlContent: '<p>{{greeting}}</p><p>About {{company}}...</p>',
  },
  { email: 'john@acme.com', url: 'https://acme.com' }
);

// Use helper
const greeting = createGreeting('John'); // "Hi John,"
```

### Validation (`validation.ts`)

Email validation and analysis:

```typescript
import {
  validateEmail,
  isDisposableEmail,
  isFreeEmail,
  extractFullNameFromEmail
} from './lib/email/validation';

const result = validateEmail('john.doe@company.com', {
  checkDisposable: true,
  checkRole: true,
});

console.log(result.valid);      // true
console.log(result.type);       // 'professional'
console.log(result.domain);     // 'company.com'

const name = extractFullNameFromEmail('john.doe@company.com'); // "John Doe"
```

## API Reference

### Types

See `types.ts` for full type definitions:

- `EmailProviderType`: 'resend' | 'sendgrid' | 'smtp' | 'gmail'
- `EmailSender`: Sender account configuration
- `EmailMessage`: Message to send
- `EmailSendResult`: Result of send attempt
- `TemplateVariables`: Variables for template substitution
- `EmailValidationResult`: Validation result with details

### Error Classes

- `EmailSystemError`: Base system error
- `EmailProviderError`: Provider-specific error
- `SenderLimitError`: Sender limit reached
- `TemplateError`: Template rendering error
- `ValidationError`: Validation error

## License

MIT
