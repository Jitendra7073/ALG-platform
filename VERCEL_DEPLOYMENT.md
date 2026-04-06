# Vercel Deployment Guide

## Overview

This project is configured to deploy on Vercel as a serverless Express application. The deployment uses two main components:

1. **`api/index.js`** - Vercel serverless entry point
2. **`src/api/server.js`** - Main Express application (exports `apiServer`)

## Architecture

### Local Development
- Runs on port 8080
- Starts background workers (AI processor, email queue)
- Initializes browser contexts for scraping
- Full PostgreSQL database connectivity

### Vercel Deployment
- Runs as serverless functions
- **NO** background workers (they don't work in serverless)
- **NO** browser contexts (Playwright requires persistent filesystem)
- API-only functionality (dashboard features disabled)

## Important Differences

| Feature | Local Development | Vercel Deployment |
|---------|------------------|-------------------|
| Background Workers | ✅ Running | ❌ Disabled |
| Browser Scraping | ✅ Full support | ❌ Not supported |
| Database | ✅ Direct access | ✅ API endpoints only |
| Admin Panel | ✅ Full UI | ✅ Read-only UI |
| AI Processing | ✅ Background | ❌ Manual only |

## Environment Variables

Required for Vercel deployment:

```env
# Database
DATABASE_URL=postgresql://user:pass@host:port/database

# AI Service
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4o-mini

# Email (optional)
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=your_app_password

# Vercel-specific
VERCEL=true
NODE_ENV=production
```

## Deployment Issues & Solutions

### Issue 1: Taskkill Error

**Error**: `Error: Command failed: taskkill /pid 1468 /T /F`

**Cause**: Playwright trying to cleanup browser processes in serverless environment

**Solution**: Already handled - browser initialization is skipped in Vercel mode

```javascript
// In server.js - automatically skips browser workers in Vercel
const isVercel = process.env.VERCEL || process.env.VERCEL_ENV;
if (!isVercel) {
  // Only start workers locally
  aiWorker.start();
  emailQueueWorker.start();
}
```

### Issue 2: Duplicate API Folders

**Structure**:
- `api/index.js` - Vercel serverless entry point
- `src/api/server.js` - Main Express app

This is **intentional** - not a duplicate issue!

### Issue 3: Database Connection Timeouts

**Problem**: Serverless functions have execution time limits

**Solution**: Use connection pooling and avoid long-running operations

```javascript
// Good: Quick API calls
app.get('/api/sites', async (req, res) => {
  const sites = await db.getAllSites(); // Fast query
  res.json({ success: true, data: sites });
});

// Bad: Long-running scrapers
app.get('/api/scrape', async (req, res) => {
  await scraper.run(); // Too slow for serverless!
  res.json({ success: true });
});
```

## Deployment Steps

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Deploy to Vercel"
   git push origin main
   ```

2. **Connect to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Import your repository
   - Vercel will auto-detect the `api/index.js` file

3. **Configure Environment Variables**
   - In Vercel dashboard: Settings → Environment Variables
   - Add all required variables from above

4. **Deploy**
   - Vercel will auto-deploy on push to main branch
   - Check deployment logs for any errors

## API Endpoints Available on Vercel

### ✅ Working Endpoints
- `GET /health` - Health check
- `GET /api/*` - All database read operations
- `POST /api/*` - Data mutations (limited)
- Static files from `/public`

### ❌ Not Available on Vercel
- Background worker endpoints
- Browser scraping operations
- Long-running operations (>10 seconds)
- File system operations

## Troubleshooting

### "Module not found" errors
**Solution**: Check that all dependencies are in `package.json`

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "better-sqlite3": "^8.0.0",
    "playwright": "^1.30.0"
  }
}
```

### "Function execution timeout"
**Solution**: Optimize database queries and avoid long operations

### "Database connection failed"
**Solution**: Ensure `DATABASE_URL` is set correctly in Vercel env vars

## Monitoring

Check Vercel dashboard for:
- Function execution times
- Error rates
- Memory usage
- Invocations per endpoint

## Cost Considerations

- Vercel Free Tier: 100GB bandwidth/month
- Serverless Function Execution: Pay-as-you-go
- Database: Use external service (Supabase, Neon, etc.)

## Best Practices

1. **Keep functions fast** - Under 5 seconds ideally
2. **Use connection pooling** - Reuse DB connections
3. **Handle errors gracefully** - Proper error responses
4. **Monitor usage** - Check Vercel analytics regularly
5. **Test locally** - Use `vercel dev` command locally first

## Local Testing

Install Vercel CLI and test locally:

```bash
npm install -g vercel
vercel dev
```

This runs the serverless functions locally before deploying.
