# Email System API Routes

This document describes all the Next.js 14 API routes created for the email system at `email-system/app/api/`.

## Base URL

All routes are prefixed with `/api` in the Next.js App Router.

---

## Queue Management Endpoints

### `GET /api/queue`
Get email queue items with optional filtering and pagination.

**Query Parameters:**
- `status` (optional): Filter by status (`queued`, `sending`, `sent`, `failed`, `cancelled`)
- `campaign_id` (optional): Filter by campaign ID
- `sender_id` (optional): Filter by sender ID
- `contact_id` (optional): Filter by contact ID
- `tag` (optional): Filter by tag
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50, max: 100)
- `offset` (optional): Offset for pagination

**Response:** Paginated list of `EmailQueueItem` objects

---

### `POST /api/queue/add`
Add a new email to the queue.

**Request Body:**
```typescript
{
  contact_id?: number;
  recipient_email?: string;
  template_id?: number;
  subject?: string;
  html_content?: string;
  text_content?: string;
  campaign_id?: number;
  tag?: string;
  sequence_position?: number;
  country_code?: string;
  scheduled_at?: string;
}
```

**Response:** Created queue item with ID

---

### `GET /api/queue/[id]`
Get a single queue item by ID.

**Response:** `EmailQueueItem` object with additional sender and site info

---

### `PUT /api/queue/[id]`
Update a queue item (cannot modify sent emails).

**Request Body:**
```typescript
{
  scheduled_at?: string;
  status?: string;
  priority?: 'high' | 'normal';
}
```

**Response:** Success message

---

### `DELETE /api/queue/[id]`
Delete/cancel a queue item (cannot delete sent emails).

**Response:** Success message

---

### `POST /api/queue/[id]/retry`
Retry a failed queue item.

**Response:** Success message

---

### `GET /api/queue/stats`
Get queue statistics.

**Response:**
```typescript
{
  total: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
  byCountry: Array<{
    country: string;
    count: number;
    inBusinessHours: boolean;
  }>;
}
```

---

### `POST /api/queue/bulk/cancel`
Cancel multiple queue items.

**Request Body:**
```typescript
{
  queue_ids: number[];
}
```

**Response:** Count of cancelled items

---

### `POST /api/queue/bulk/retry`
Retry multiple failed queue items.

**Request Body:**
```typescript
{
  queue_ids?: number[];
  all_failed?: boolean;
}
```

**Response:** Count of retried items

---

### `POST /api/queue/trigger`
Trigger immediate queue processing.

**Response:** Success message

---

### `POST /api/queue/pause`
Pause queue processing.

**Response:** Success message

---

### `POST /api/queue/resume`
Resume queue processing.

**Response:** Success message

---

## Publish Endpoint (External Integration)

### `POST /api/publish`
Receive published lead data from WordPress detector system.

This endpoint allows external systems to publish contact data. It checks for duplicates in `email_send_log` and adds new contacts to the `contacts` table.

**Request Body:**
```typescript
{
  contacts: Array<{
    id: number;
    email: string;
    name?: string;
    site_id: number;
    site_url: string;
    country?: string;
    company_name?: string;
  }>;
}
```

**Response:**
```typescript
{
  total_received: number;
  processed: number;
  added: number;
  skipped: {
    duplicates: number;
    invalid: number;
  };
  errors: Array<{
    email: string;
    reason: string;
  }>;
}
```

**Behavior:**
- Validates email format for each contact
- Checks `email_send_log` table for existing emails (to avoid duplicates)
- Checks `contacts` table for existing contacts with same site_id and email
- Inserts new contacts into `contacts` table with type='email'
- Returns statistics about processed, added, and skipped contacts

**Example Request:**
```json
{
  "contacts": [
    {
      "id": 1,
      "email": "contact@example.com",
      "name": "John Doe",
      "site_id": 123,
      "site_url": "https://example.com",
      "country": "in",
      "company_name": "Example Company"
    }
  ]
}
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "total_received": 1,
    "processed": 1,
    "added": 1,
    "skipped": {
      "duplicates": 0,
      "invalid": 0
    },
    "errors": []
  },
  "message": "Contacts processed successfully"
}
```

---

## Contacts Endpoints

### `GET /api/contacts`
Get contacts with optional filtering and pagination.

**Query Parameters:**
- `site_id` (optional): Filter by site ID
- `type` (optional): Filter by type (`email`, `phone`, `linkedin`)
- `search` (optional): Search by value
- `page` (optional): Page number
- `limit` (optional): Items per page
- `offset` (optional): Offset for pagination

**Response:** Paginated list of `ContactWithSite` objects

---

### `GET /api/contacts/[id]/history`
Get email send history for a specific contact.

**Response:**
```typescript
{
  contact: { id: number; value: string };
  stats: { total: number; sent: number; failed: number };
  history: EmailSendLog[];
}
```

---

## Leads Endpoints

### `GET /api/leads`
Get leads (sites with contacts) for email campaigns.

**Query Parameters:**
- `country` (optional): Filter by country code
- `relevant_only` (optional): Only include AI-relevant sites
- `tag` (optional): Filter by tag
- `with_email` (optional): Only include sites with email contacts (default: true)
- `page` (optional): Page number
- `limit` (optional): Items per page

**Response:** Paginated list of `Lead` objects

---

## Templates Endpoints

### `GET /api/templates`
Get email templates.

**Query Parameters:**
- `tag` (optional): Filter by tag
- `category` (optional): Filter by category
- `active` (optional): Only active templates (`true`/`false`)

**Response:** List of `EmailTemplate` objects

---

### `POST /api/templates`
Create a new email template.

**Request Body:**
```typescript
{
  name: string;
  subject: string;
  html_content: string;
  text_content?: string;
  description?: string;
  category?: TemplateCategory;
  tags?: string;
  sequence_number?: number;
}
```

**Response:** Created template

---

### `GET /api/templates/[id]`
Get a single template by ID.

**Response:** `EmailTemplate` object

---

### `PUT /api/templates/[id]`
Update a template.

**Request Body:**
```typescript
{
  name?: string;
  subject?: string;
  html_content?: string;
  text_content?: string;
  description?: string;
  category?: TemplateCategory;
  tags?: string;
  sequence_number?: number;
  is_active?: boolean;
}
```

**Response:** Updated template

---

### `DELETE /api/templates/[id]`
Delete a template (cannot delete if used by active campaigns).

**Response:** Success message

---

### `GET /api/templates/tags`
Get all unique tags from email templates.

**Response:** Array of tag strings

---

## Campaigns Endpoints

### `GET /api/campaigns`
Get email campaigns.

**Query Parameters:**
- `status` (optional): Filter by status
- `page` (optional): Page number
- `limit` (optional): Items per page

**Response:** Paginated list of `EmailCampaign` objects with template info

---

### `POST /api/campaigns`
Create a new campaign.

**Request Body:**
```typescript
{
  name: string;
  template_id?: number;
  target_type?: CampaignTargetType;
  tag_filter?: string;
  site_ids?: number[];
  contact_ids?: number[];
}
```

**Response:** Created campaign

---

### `GET /api/campaigns/[id]`
Get a single campaign with recent queue items.

**Response:** Campaign with `recent_queue_items` array

---

### `PUT /api/campaigns/[id]`
Update a campaign (cannot modify running campaigns).

**Request Body:**
```typescript
{
  name?: string;
  template_id?: number;
  target_type?: CampaignTargetType;
  status?: CampaignStatus;
}
```

**Response:** Updated campaign

---

### `DELETE /api/campaigns/[id]`
Delete a campaign (cannot delete running campaigns).

**Response:** Success message

---

### `POST /api/campaigns/[id]/start`
Start a campaign (queue all emails).

**Request Body:**
```typescript
{
  send_immediately?: boolean;
  scheduled_at?: string;
}
```

**Response:**
```typescript
{
  campaign_id: number;
  queued: number;
}
```

---

## Senders Endpoints

### `GET /api/senders`
Get all email senders.

**Response:** List of `EmailSender` objects

---

### `POST /api/senders`
Create a new email sender.

**Request Body:**
```typescript
{
  name: string;
  email: string;
  password: string;
  service?: SenderService;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  daily_limit?: number;
}
```

**Response:** Created sender (without password)

---

### `GET /api/senders/[id]`
Get a single sender by ID (without password).

**Response:** `EmailSender` object

---

### `PUT /api/senders/[id]`
Update a sender.

**Request Body:**
```typescript
{
  name?: string;
  email?: string;
  password?: string;
  service?: SenderService;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  daily_limit?: number;
}
```

**Response:** Updated sender

---

### `DELETE /api/senders/[id]`
Delete a sender (cannot delete with pending emails).

**Response:** Success message

---

### `POST /api/senders/[id]/toggle`
Toggle sender active/inactive status.

**Response:** Updated status

---

### `POST /api/senders/[id]/test`
Test email sender connection.

**Response:** Connection test result

---

## Settings Endpoints

### `GET /api/settings`
Get all email system settings.

**Response:**
```typescript
{
  settings: EmailSetting[];
  values: Record<string, string>;
}
```

---

### `PUT /api/settings`
Update email system settings.

**Request Body:**
```typescript
{
  settings: Record<string, string | number>;
}
```

**Response:** Count of updated settings

---

## Health Endpoints

### `GET /api/health`
Get system health status.

**Response:**
```typescript
{
  health: WorkerHealthStatus;
  queue_counts: Record<string, number>;
  database_size_bytes: number;
  timestamp: string;
}
```

---

## TypeScript Types

All types are defined in `app/api/types.ts`:

- `EmailQueueItem`, `EmailQueueStatus`
- `QueueStats`, `AddToQueueRequest`, `BulkQueueRequest`
- `Contact`, `ContactWithSite`, `EmailSendLog`, `Lead`
- `EmailTemplate`, `TemplateCategory`, `CreateTemplateRequest`, `UpdateTemplateRequest`
- `EmailCampaign`, `CampaignStatus`, `CampaignTargetType`, `CreateCampaignRequest`
- `EmailSender`, `SenderService`, `CreateSenderRequest`, `UpdateSenderRequest`
- `EmailSetting`, `SystemSettings`
- `WorkerHealthStatus`
- `ApiResponse`, `PaginatedResponse`

---

## Database

The API uses SQLite with the database at `../wordpress-detector.db` (relative to the API directory).

Database utilities are in `app/api/db.ts`:
- `getDb()`: Get singleton database connection
- `dbAll()`, `dbGet()`, `dbRun()`: Query helpers
- `initializeEmailTables()`: Initialize email system tables

---

## Validation

Validation utilities are in `app/api/validation.ts`:
- `errorResponse()`, `successResponse()`: Response helpers
- `validateEmail()`, `validateUrl()`: Validation functions
- `getPaginationParams()`: Pagination helper
- `withErrorHandler()`: Error handling wrapper
- `getIdParam()`: Route parameter helper
