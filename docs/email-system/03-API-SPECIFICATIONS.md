# Email System - API Specifications

## API Architecture

### Base URL
```
Production: https://your-domain.com/api/email-system
Development: http://localhost:3000/api/email-system
```

### Authentication
- **Server-side**: Service role key (Supabase)
- **Client-side**: Session-based authentication
- **Rate Limiting**: 100 requests/minute per user

### Response Format
```json
{
  "success": true|false,
  "data": {},
  "error": "Error message if success=false",
  "meta": {
    "timestamp": "2026-04-07T10:30:00Z",
    "requestId": "uuid"
  }
}
```

## 1. Template Groups API

### GET /api/email-system/template-groups
Get all template groups

**Query Params:**
- `search` (optional): Filter by name
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "coupon",
      "description": "Coupon campaign templates",
      "template_count": 4,
      "created_at": "2026-04-07T10:00:00Z",
      "updated_at": "2026-04-07T10:00:00Z"
    }
  ],
  "meta": {
    "total": 10,
    "page": 1,
    "limit": 20
  }
}
```

### GET /api/email-system/template-groups/:id
Get single template group with templates

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "coupon",
    "description": "Coupon campaign templates",
    "templates": [
      {
        "id": "uuid",
        "name": "Welcome Email",
        "position": 1,
        "gap_days": 0,
        "gap_hours": 0,
        "gap_minutes": 0,
        "send_time": "09:00"
      }
    ]
  }
}
```

### POST /api/email-system/template-groups
Create new template group

**Request:**
```json
{
  "name": "coupon",
  "description": "Coupon campaign templates"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "coupon",
    "description": "Coupon campaign templates",
    "created_at": "2026-04-07T10:00:00Z"
  }
}
```

### PUT /api/email-system/template-groups/:id
Update template group

**Request:**
```json
{
  "name": "coupon-updated",
  "description": "Updated description"
}
```

### DELETE /api/email-system/template-groups/:id
Delete template group (cascades to members)

**Response:**
```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

### POST /api/email-system/template-groups/:id/templates
Add template to group

**Request:**
```json
{
  "template_id": "uuid",
  "position": 1,
  "gap_days": 2,
  "gap_hours": 0,
  "gap_minutes": 0,
  "send_time": "10:30"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "template_id": "uuid",
    "group_id": "uuid",
    "position": 1,
    "gap_days": 2,
    "gap_hours": 0,
    "gap_minutes": 0,
    "send_time": "10:30"
  }
}
```

### PUT /api/email-system/template-groups/:id/templates/reorder
Reorder templates in group

**Request:**
```json
{
  "templates": [
    {
      "template_id": "uuid",
      "position": 1,
      "gap_days": 0,
      "gap_hours": 0,
      "gap_minutes": 0,
      "send_time": "09:00"
    },
    {
      "template_id": "uuid",
      "position": 2,
      "gap_days": 2,
      "gap_hours": 0,
      "gap_minutes": 0,
      "send_time": "10:30"
    }
  ]
}
```

### DELETE /api/email-system/template-groups/:id/templates/:templateId
Remove template from group

## 2. Templates API

### GET /api/email-system/templates
Get all templates

**Query Params:**
- `search` (optional): Filter by name
- `group_id` (optional): Filter by group membership
- `page` (optional): Page number
- `limit` (optional): Items per page

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Welcome Email",
      "subject": "Welcome to {{company_name}}",
      "description": "Initial welcome email",
      "variable_schema": {
        "first_name": "text",
        "company_name": "text",
        "coupon_code": "text"
      },
      "groups": ["coupon", "newsletter"],
      "created_at": "2026-04-07T10:00:00Z"
    }
  ]
}
```

### GET /api/email-system/templates/:id
Get single template

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Welcome Email",
    "subject": "Welcome to {{company_name}}",
    "html_content": "<html>...</html>",
    "text_content": "Plain text version",
    "description": "Initial welcome email",
    "variable_schema": {
      "first_name": "text",
      "company_name": "text",
      "coupon_code": "text"
    },
    "groups": [
      {
        "id": "uuid",
        "name": "coupon",
        "position": 1
      }
    ],
    "created_at": "2026-04-07T10:00:00Z"
  }
}
```

### POST /api/email-system/templates
Create new template

**Request:**
```json
{
  "name": "Welcome Email",
  "subject": "Welcome to {{company_name}}",
  "html_content": "<html>...</html>",
  "text_content": "Plain text version",
  "description": "Initial welcome email",
  "variable_schema": {
    "first_name": "text",
    "company_name": "text",
    "coupon_code": "text"
  }
}
```

### PUT /api/email-system/templates/:id
Update template (propagates to pending emails)

**Request:**
```json
{
  "name": "Welcome Email Updated",
  "subject": "Welcome to {{company_name}}",
  "html_content": "<html>...</html>",
  "text_content": "Plain text version",
  "description": "Updated welcome email"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "updated_at": "2026-04-07T11:00:00Z",
    "pending_emails_updated": 15
  }
}
```

### DELETE /api/email-system/templates/:id
Delete template (removes from all groups)

## 3. Contacts API

### GET /api/email-system/contacts
Get all contacts

**Query Params:**
- `search` (optional): Filter by email/name
- `country_code` (optional): Filter by country
- `page` (optional): Page number
- `limit` (optional): Items per page

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "email": "john@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "phone": "+1234567890",
      "linkedin_url": "https://linkedin.com/in/johndoe",
      "country_code": "US",
      "region": "New York",
      "company_name": "Example Inc",
      "company_website": "https://example.com",
      "synced_at": "2026-04-07T10:00:00Z"
    }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

### POST /api/email-system/contacts/sync
Sync contacts from local SQLite

**Request:**
```json
{
  "force": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "synced": 50,
    "skipped": 100,
    "failed": 0,
    "sync_time": "2026-04-07T10:00:00Z"
  }
}
```

### GET /api/email-system/contacts/:id
Get single contact

### POST /api/email-system/contacts
Add contact manually

**Request:**
```json
{
  "email": "jane@example.com",
  "first_name": "Jane",
  "last_name": "Smith",
  "country_code": "UK",
  "company_name": "Acme Corp"
}
```

### POST /api/email-system/contacts/import
Import contacts from CSV

**Request:**
```
FormData {
  file: CSV file,
  mapping: {
    email: 0,
    first_name: 1,
    last_name: 2,
    country_code: 3
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "imported": 100,
    "failed": 5,
    "errors": [
      {
        "row": 10,
        "error": "Invalid email format"
      }
    ]
  }
}
```

## 4. Senders API

### GET /api/email-system/senders
Get all sender accounts

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "sender_name": "Main Account",
      "email": "sender@example.com",
      "smtp_host": "smtp.gmail.com",
      "smtp_port": 587,
      "daily_limit": 100,
      "is_active": true,
      "total_sent": 500,
      "total_failed": 5,
      "success_rate": 99.0,
      "health_status": "healthy",
      "today_sent": 50,
      "last_used_at": "2026-04-07T10:00:00Z"
    }
  ]
}
```

### POST /api/email-system/senders
Create new sender account

**Request:**
```json
{
  "sender_name": "Main Account",
  "email": "sender@example.com",
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "app_password": "encrypted_password",
  "daily_limit": 100
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "sender_name": "Main Account",
    "email": "sender@example.com",
    "created_at": "2026-04-07T10:00:00Z"
  }
}
```

### PUT /api/email-system/senders/:id
Update sender account

### PUT /api/email-system/senders/:id/toggle
Toggle sender active status

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "is_active": false
  }
}
```

### DELETE /api/email-system/senders/:id
Delete sender account

### GET /api/email-system/senders/:id/stats
Get sender statistics

**Response:**
```json
{
  "success": true,
  "data": {
    "total_sent": 500,
    "total_failed": 5,
    "total_bounces": 2,
    "success_rate": 99.0,
    "today_sent": 50,
    "today_remaining": 50,
    "last_30_days": {
      "sent": 300,
      "failed": 3,
      "success_rate": 99.0
    }
  }
}
```

## 5. Campaigns API

### GET /api/email-system/campaigns
Get all campaigns

**Query Params:**
- `status` (optional): Filter by status
- `search` (optional): Filter by name
- `page` (optional): Page number
- `limit` (optional): Items per page

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "April Coupon Campaign",
      "description": "Monthly coupon campaign",
      "group_id": "uuid",
      "group_name": "coupon",
      "status": "active",
      "total_contacts": 100,
      "total_queued": 400,
      "total_sent": 100,
      "total_failed": 0,
      "created_at": "2026-04-07T10:00:00Z",
      "started_at": "2026-04-07T10:05:00Z",
      "progress": {
        "percent": 25,
        "emails_sent": 100,
        "emails_remaining": 300
      }
    }
  ]
}
```

### POST /api/email-system/campaigns
Create new campaign

**Request:**
```json
{
  "name": "April Coupon Campaign",
  "description": "Monthly coupon campaign",
  "group_id": "uuid",
  "contact_ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "April Coupon Campaign",
    "status": "active",
    "total_contacts": 3,
    "total_queued": 12,
    "duplicate_prevention": {
      "skipped": 0,
      "warnings": [
        {
          "contact_email": "john@example.com",
          "reason": "Active coupon campaign in progress"
        }
      ]
    },
    "created_at": "2026-04-07T10:00:00Z"
  }
}
```

### GET /api/email-system/campaigns/:id
Get single campaign with queue

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "April Coupon Campaign",
    "description": "Monthly coupon campaign",
    "group_id": "uuid",
    "group_name": "coupon",
    "status": "active",
    "total_contacts": 3,
    "total_queued": 12,
    "total_sent": 3,
    "total_failed": 0,
    "queue": [
      {
        "id": "uuid",
        "contact_email": "john@example.com",
        "template_name": "Welcome Email",
        "position": 1,
        "status": "sent",
        "scheduled_at": "2026-04-07T09:00:00Z",
        "sent_at": "2026-04-07T09:01:00Z",
        "timezone_conversion": {
          "scheduled": "2026-04-07T09:00:00Z",
          "recipient_timezone": "America/New_York",
          "recipient_time": "2026-04-06T23:30:00-05:00",
          "adjusted": true,
          "adjustment_reason": "weekend"
        }
      }
    ]
  }
}
```

### PUT /api/email-system/campaigns/:id
Update campaign

### PUT /api/email-system/campaigns/:id/pause
Pause campaign

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "paused",
    "paused_at": "2026-04-07T10:00:00Z"
  }
}
```

### PUT /api/email-system/campaigns/:id/resume
Resume campaign

### DELETE /api/email-system/campaigns/:id
Cancel/delete campaign

**Response:**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "queue_deleted": 12
  }
}
```

### GET /api/email-system/campaigns/:id/stats
Get campaign statistics

**Response:**
```json
{
  "success": true,
  "data": {
    "total_queued": 12,
    "total_sent": 4,
    "total_failed": 0,
    "total_cancelled": 0,
    "total_pending": 8,
    "by_position": {
      "1": {
        "sent": 3,
        "failed": 0,
        "pending": 0
      },
      "2": {
        "sent": 1,
        "failed": 0,
        "pending": 2
      }
    },
    "by_status": {
      "sent": 4,
      "pending": 8,
      "failed": 0
    }
  }
}
```

## 6. Queue API

### GET /api/email-system/queue
Get email queue

**Query Params:**
- `campaign_id` (optional): Filter by campaign
- `status` (optional): Filter by status
- `contact_id` (optional): Filter by contact
- `sender_id` (optional): Filter by sender
- `page` (optional): Page number
- `limit` (optional): Items per page

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "campaign_id": "uuid",
      "campaign_name": "April Coupon Campaign",
      "contact_email": "john@example.com",
      "sender_email": "sender@example.com",
      "template_name": "Welcome Email",
      "group_name": "coupon",
      "position": 1,
      "status": "sent",
      "scheduled_at": "2026-04-07T09:00:00Z",
      "sent_at": "2026-04-07T09:01:00Z",
      "dependency_satisfied": true,
      "timezone_conversion": {
        "recipient_timezone": "America/New_York",
        "recipient_time": "2026-04-06T23:30:00-05:00",
        "adjusted": true,
        "adjustment_reason": "weekend"
      },
      "created_at": "2026-04-07T08:00:00Z"
    }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

### GET /api/email-system/queue/:id
Get single email from queue

### POST /api/email-system/queue/:id/send-now
Send email immediately (bypass schedule)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "sending",
    "sent_at": "2026-04-07T10:00:00Z"
  }
}
```

### POST /api/email-system/queue/:id/resend
Resend failed email

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "pending",
    "retry_count": 1,
    "scheduled_at": "2026-04-07T10:05:00Z"
  }
}
```

### POST /api/email-system/queue/:id/cancel
Cancel scheduled email

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "cancelled",
    "cancelled_at": "2026-04-07T10:00:00Z"
  }
}
```

### POST /api/email-system/queue/:id/pause
Pause email (don't send, keep in queue)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "paused",
    "paused_at": "2026-04-07T10:00:00Z"
  }
}
```

### POST /api/email-system/queue/:id/resume
Resume paused email

### DELETE /api/email-system/queue/:id
Delete email from queue

## 7. Schedule API

### POST /api/email-system/schedule/calculate
Calculate timezone-aware schedule

**Request:**
```json
{
  "recipient_country": "US",
  "recipient_timezone": "America/New_York",
  "base_time": "2026-04-07T09:00:00Z",
  "gap_days": 2,
  "gap_hours": 0,
  "gap_minutes": 0,
  "send_time": "10:30"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "original_scheduled_at": "2026-04-09T10:30:00Z",
    "adjusted_scheduled_at": "2026-04-09T10:30:00Z",
    "timezone_conversion": {
      "from_timezone": "Asia/Kolkata",
      "to_timezone": "America/New_York",
      "from_time": "2026-04-09T20:00:00+05:30",
      "to_time": "2026-04-09T10:30:00-05:00"
    },
    "business_hours_check": {
      "is_business_hours": true,
      "business_hours_start": "09:00",
      "business_hours_end": "18:00",
      "recipient_time": "10:30:00"
    },
    "weekend_check": {
      "is_weekend": false,
      "day_of_week": "Thursday"
    },
    "adjustments": []
  }
}
```

**Example with adjustments:**

```json
{
  "success": true,
  "data": {
    "original_scheduled_at": "2026-04-06T09:00:00Z",
    "adjusted_scheduled_at": "2026-04-08T09:00:00Z",
    "timezone_conversion": {
      "from_timezone": "Asia/Kolkata",
      "to_timezone": "America/New_York",
      "from_time": "2026-04-08T18:30:00+05:30",
      "to_time": "2026-04-08T09:00:00-05:00"
    },
    "business_hours_check": {
      "is_business_hours": true,
      "business_hours_start": "09:00",
      "business_hours_end": "18:00",
      "recipient_time": "09:00:00"
    },
    "weekend_check": {
      "is_weekend": false,
      "day_of_week": "Monday"
    },
    "adjustments": [
      {
        "type": "weekend",
        "reason": "Original time landed on Sunday",
        "from": "2026-04-06T09:00:00Z",
        "to": "2026-04-08T09:00:00Z"
      }
    ]
  }
}
```

### GET /api/email-system/schedule/timezones
Get available timezones

**Query Params:**
- `country_code` (optional): Filter by country

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "country_code": "US",
      "country_name": "United States",
      "default_timezone": "America/New_York",
      "business_hours_start": "09:00",
      "business_hours_end": "18:00",
      "weekend_days": ["Saturday", "Sunday"]
    },
    {
      "country_code": "IN",
      "country_name": "India",
      "default_timezone": "Asia/Kolkata",
      "business_hours_start": "09:00",
      "business_hours_end": "18:00",
      "weekend_days": ["Saturday", "Sunday"]
    }
  ]
}
```

## 8. Status & Monitoring API

### GET /api/email-system/status/queue
Get real-time queue status

**Response:**
```json
{
  "success": true,
  "data": {
    "total_pending": 150,
    "total_scheduled": 50,
    "total_sending": 5,
    "total_sent_today": 100,
    "total_failed_today": 5,
    "active_senders": 3,
    "next_send_at": "2026-04-07T10:05:00Z",
    "by_status": {
      "pending": 150,
      "scheduled": 50,
      "sending": 5,
      "sent": 1000,
      "failed": 10,
      "cancelled": 5,
      "paused": 20
    }
  }
}
```

### GET /api/email-system/status/senders
Get sender status

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "sender_name": "Main Account",
      "email": "sender@example.com",
      "is_active": true,
      "health_status": "healthy",
      "today_sent": 50,
      "today_remaining": 50,
      "success_rate": 99.0,
      "currently_sending": 2
    }
  ]
}
```

### GET /api/email-system/status/stats
Get overall statistics

**Response:**
```json
{
  "success": true,
  "data": {
    "total_campaigns": 10,
    "active_campaigns": 3,
    "total_contacts": 500,
    "total_emails_sent": 5000,
    "total_emails_failed": 50,
    "overall_success_rate": 99.0,
    "today_sent": 100,
    "this_week_sent": 500,
    "this_month_sent": 2000
  }
}
```

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "error": "Invalid request data",
  "details": {
    "field": "email",
    "message": "Email is required"
  }
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "error": "Authentication required"
}
```

### 404 Not Found
```json
{
  "success": false,
  "error": "Resource not found",
  "resource": "template_group",
  "id": "uuid"
}
```

### 409 Conflict
```json
{
  "success": false,
  "error": "Resource already exists",
  "details": {
    "field": "name",
    "value": "coupon",
    "message": "Template group with this name already exists"
  }
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Internal server error",
  "request_id": "uuid"
}
```

## Rate Limiting

### Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1617805200
```

### 429 Too Many Requests
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "retry_after": 60
}
```

## Webhooks

### POST /api/email-system/webhooks/email-sent
Webhook for email sent event

**Request:**
```json
{
  "event": "email.sent",
  "data": {
    "queue_id": "uuid",
    "campaign_id": "uuid",
    "contact_email": "john@example.com",
    "sent_at": "2026-04-07T10:00:00Z"
  }
}
```

### POST /api/email-system/webhooks/email-failed
Webhook for email failed event

**Request:**
```json
{
  "event": "email.failed",
  "data": {
    "queue_id": "uuid",
    "campaign_id": "uuid",
    "contact_email": "john@example.com",
    "failed_at": "2026-04-07T10:00:00Z",
    "error": "SMTP connection timeout"
  }
}
```
