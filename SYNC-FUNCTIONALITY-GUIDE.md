# Sync to Production - Complete Implementation Guide

## Overview
The sync functionality automatically syncs local SQLite data to the production Supabase database. It handles three core tables: **sites**, **contacts**, and **keywords**.

## What Gets Synced

### 1. **Sites Table**
- All site data including WordPress detection results
- AI analysis results (classification, relevance, categories)
- Contact information (emails, phones, LinkedIn profiles)
- Metadata (titles, descriptions, text content)
- Retry and processing status

### 2. **Contacts Table**
- Email addresses
- Phone numbers
- LinkedIn profiles
- Source page information

### 3. **Keywords Table**
- Keyword text
- Status (pending, processing, completed)
- Max sites setting

## How It Works

### Sync Tracking
Each record has an `is_sync_to_prod` column:
- **0** = Needs to be synced (or has been modified since last sync)
- **1** = Already synced to production

### Automatic Change Detection
When any record is **updated** in the local database, it's automatically marked for re-sync (`is_sync_to_prod = 0`). This ensures changes are never missed.

### Sync Process
1. **Query**: Find all records where `is_sync_to_prod = 0` (limited to 100 per table per sync)
2. **Upload**: Insert/update records in Supabase using UPSERT (ON CONFLICT DO UPDATE)
3. **Mark Complete**: Set `is_sync_to_prod = 1` for successfully synced records

### Duplicate Prevention
The sync uses **UPSERT** logic:
- **New records**: Inserted into Supabase
- **Existing records**: Updated with latest data from local SQLite
- **No duplicates**: Uses `ON CONFLICT (id) DO UPDATE` to handle duplicates gracefully

## How to Trigger Sync

### Option 1: Admin Panel UI (Recommended)
1. Go to `http://localhost:8080`
2. Click the **"Sync to Prod"** button in the dashboard
3. View real-time progress and results

### Option 2: API Endpoint
```bash
curl -X POST http://localhost:8080/api/sync-to-prod
```

### Option 3: Automatic Sync
The system can be configured to sync automatically on a schedule using cron jobs or similar automation tools.

## Sync Response Example

```json
{
  "success": true,
  "message": "Sync completed: 25 sites, 150 contacts, 3 keywords.",
  "results": {
    "sitesSynced": 25,
    "contactsSynced": 150,
    "keywordsSynced": 3
  }
}
```

## Change Detection Examples

### When Records Are Marked for Re-Sync (`is_sync_to_prod = 0`):

1. **Site Updates**:
   - AI classification changes
   - Status updates (pending → completed)
   - Retry count changes
   - Any manual edits via admin panel

2. **Contact Updates**:
   - Value changes (email/phone/linkedin)
   - Source page updates

3. **Keyword Updates**:
   - Status changes
   - Max sites setting changes
   - Keyword text modifications

## Database Schema Changes

### Local SQLite Tables
All sync-enabled tables have this column:
```sql
is_sync_to_prod INTEGER DEFAULT 0
```

### Production Supabase Tables
Supabase tables must have matching schema with:
- Primary key `id`
- All corresponding columns
- Proper indexes for performance

## Configuration

### Environment Variables (`.env`)
```env
# Supabase Connection
DATABASE_URL=postgresql://user:password@host:port/database

# Optional: Sync batch size (default: 100)
SYNC_BATCH_SIZE=100
```

## Troubleshooting

### Issue: "DATABASE_URL is not set"
**Solution**: Add your Supabase connection string to `.env` file

### Issue: Records not syncing
**Check**:
1. Run `SELECT COUNT(*) FROM sites WHERE is_sync_to_prod = 0;` in SQLite
2. Verify DATABASE_URL is correct
3. Check Supabase connection and permissions

### Issue: Duplicate records in Supabase
**Solution**: The sync uses UPSERT, so duplicates shouldn't occur. If you see duplicates, check:
1. Primary key constraints in Supabase
2. Sync logs for errors

### Issue: Sync takes too long
**Solution**:
1. Reduce `SYNC_BATCH_SIZE` in environment variables
2. Sync more frequently with smaller batches
3. Check network latency to Supabase

## Monitoring

### Check Sync Status
```sql
-- In local SQLite
SELECT 
  (SELECT COUNT(*) FROM sites WHERE is_sync_to_prod = 0) as sites_pending,
  (SELECT COUNT(*) FROM contacts WHERE is_sync_to_prod = 0) as contacts_pending,
  (SELECT COUNT(*) FROM keywords WHERE is_sync_to_prod = 0) as keywords_pending;
```

### Manual Mark for Re-Sync
If you need to force a re-sync of all data:
```sql
UPDATE sites SET is_sync_to_prod = 0;
UPDATE contacts SET is_sync_to_prod = 0;
UPDATE keywords SET is_sync_to_prod = 0;
```

## Best Practices

1. **Sync Regularly**: Set up automated syncs (e.g., every 5-10 minutes)
2. **Monitor Logs**: Check sync results for any errors
3. **Test Changes**: Always test schema changes in development first
4. **Backup Data**: Keep backups of both SQLite and Supabase before major changes
5. **Handle Conflicts**: Decide on conflict resolution strategy (local vs remote wins)

## Files Modified

1. **`src/api/sync-database-api.js`**
   - Enhanced sync endpoint with keywords support
   - Improved error handling
   - Better field mapping for sites table

2. **`src/database/database.js`**
   - Added `is_sync_to_prod` column to all tables
   - Modified UPDATE functions to mark records for re-sync
   - Functions affected:
     - `updateSite()`
     - `updateContact()`
     - `updateKeyword()`
     - `updateKeywordStatus()`
     - `updateSiteAIResults()`
     - `updateSiteAIStatus()`
     - `updateExecutive()`
     - `updateExcludedDomain()`
     - `updateIgnoredTag()`

## API Endpoint Details

### POST `/api/sync-to-prod`

**Request**: Empty body

**Response**:
```json
{
  "success": true|false,
  "message": "Human-readable message",
  "results": {
    "sitesSynced": number,
    "contactsSynced": number,
    "keywordsSynced": number
  },
  "error": "Error message if success=false"
}
```

**Behavior**:
- Syncs up to 100 records per table per call
- Returns count of synced records
- Marks synced records as `is_sync_to_prod = 1`
- Rolls back on errors within each table's transaction

## Security Considerations

1. **Environment Variables**: Never commit `.env` with real credentials
2. **Database Permissions**: Supabase user should have INSERT/UPDATE permissions only
3. **API Authentication**: Consider adding API key authentication for production use
4. **Rate Limiting**: Implement rate limiting on the sync endpoint

## Future Enhancements

Potential improvements:
1. **Real-time sync**: Use triggers to sync immediately on changes
2. **Conflict resolution**: Smart merging of conflicting changes
3. **Selective sync**: Sync only specific tables or records
4. **Sync history**: Track when records were last synced
5. **Bi-directional sync**: Sync changes from Supabase back to SQLite
6. **Compression**: Compress large payloads before transmission
