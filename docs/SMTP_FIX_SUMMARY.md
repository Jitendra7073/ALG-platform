# SMTP Username Fix - Summary

## Problem Identified

When using custom SMTP connections (especially for Gmail sub-emails/aliases), the system was failing with authentication error:

```
Connection failed: Invalid login: 535-5.7.8 Username and Password not accepted
```

### Root Cause

The system was using the **sender email field** for both:
1. The "from" address (what recipients see)
2. The SMTP authentication username

For Gmail sub-emails/aliases, these are **different**:
- **From address**: `sub@domain.com` (the sub-email)
- **SMTP username**: `mainaccount@gmail.com` (the main account for authentication)
- **Password**: App password from main account

## Solution Implemented

Added a separate **SMTP Username** field (`smtp_user`) to the email senders table and all related functionality.

### Changes Made

#### 1. Database Schema (`src/services/email/email-senders-templates-api.js`)
- Added `smtp_user TEXT` column to `email_senders` table
- Migration script automatically adds the column if it doesn't exist

#### 2. API Endpoints Updated
- **POST /api/email/senders** - Accepts `smtp_user` field
- **PUT /api/email/senders/:id** - Updates `smtp_user` field
- **GET /api/email/senders** - Returns `smtp_user` field
- **GET /api/email/senders/:id** - Returns `smtp_user` field
- **POST /api/email/senders/:id/test** - Uses `smtp_user` for authentication if provided

#### 3. Email Queue Worker (`src/services/email/email-queue-worker.js`)
- Updated `sendEmail()` function to use `smtp_user` for authentication
- Falls back to `email` field if `smtp_user` is not provided

#### 4. Frontend (`public/index.html`)
- Added "SMTP Username" input field in sender form
- Field is shown only when "Service" is set to "Custom SMTP"
- Includes helpful placeholder and description text
- JavaScript handler shows/hides the field based on service selection

## How to Use

### For Gmail Sub-emails/Aliases

When adding a sender with a Gmail sub-email:

1. **Name**: `My Sub-email Sender`
2. **Email**: `sub@mydomain.com` (the "from" address)
3. **Password**: App password from main account
4. **Service**: `Custom SMTP`
5. **SMTP Host**: `smtp.gmail.com`
6. **SMTP Port**: `587`
7. **SMTP Username**: `mainaccount@gmail.com` (the main account email)

### For Regular Gmail

No changes needed - leave SMTP Username blank:

1. **Name**: `My Gmail Sender`
2. **Email**: `myaccount@gmail.com`
3. **Password**: App password
4. **Service**: `Gmail`
5. **SMTP Host**: (auto-filled)
6. **SMTP Port**: (auto-filled)
7. **SMTP Username**: (leave blank - will use email field)

### For Other SMTP Services

1. **Name**: `My SMTP Sender`
2. **Email**: `sender@mydomain.com` (the "from" address)
3. **Password**: SMTP password
4. **Service**: `Custom SMTP`
5. **SMTP Host**: Your SMTP server hostname
6. **SMTP Port**: Your SMTP port (587 for TLS, 465 for SSL)
7. **SMTP Username**: Your SMTP authentication username (if different from email)

## Backward Compatibility

✅ **Fully backward compatible**:
- If `smtp_user` is not provided, the system uses the `email` field (original behavior)
- Existing senders continue to work without modification
- No migration needed for existing data

## Testing

After implementing this fix:

1. Test with Gmail sub-email using main account for authentication
2. Test with regular Gmail (leave SMTP Username blank)
3. Test with other SMTP providers
4. Verify connection test works for all scenarios

## Files Modified

1. `src/services/email/email-senders-templates-api.js`
   - Database schema with `smtp_user` column
   - All CRUD endpoints updated
   - Test connection endpoint updated

2. `src/services/email/email-queue-worker.js`
   - `sendEmail()` function updated to use `smtp_user`

3. `public/index.html`
   - Added SMTP Username input field
   - Updated JavaScript to show/hide field based on service selection

## Migration Notes

- The database migration runs automatically when the server starts
- Existing senders will have `smtp_user` as NULL (uses email field)
- New senders can optionally provide `smtp_user` for custom SMTP authentication
