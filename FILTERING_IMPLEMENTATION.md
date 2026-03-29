# Excluded Domains & Ignored Tags - Filtering Implementation

## Overview

The system now properly filters out **excluded domains** and **ignored tags** during both scraping and AI processing phases.

## Implementation Details

### 1. WordPress Detector (Scraper) - URL Filtering

**File:** `wordpress-detector.js`

The scraper now filters URLs in two stages:

#### Stage 1: Excluded Domains
- Checks if URL domain matches any domain in `excluded_domains` table
- Uses `db.getAllExcludedDomains()` and `db.isUrlExcluded()`
- Logs: `⛔ Excluded by domain:`

#### Stage 2: Ignored Tags (URL Scope)
- Checks if URL matches any ignored tags where `scope = 'url'` or `scope IS NULL`
- Uses `db.getAllIgnoredTags()` and `db.isUrlIgnored()`
- Supports all match types:
  - **exact**: Full URL match
  - **regex**: Regular expression pattern
  - **contains**: Substring match (default)
- Logs: `🚫 Ignored by tags:`

**Example:**
```javascript
// Filter out URLs from excluded domains
const excludedDomains = db.getAllExcludedDomains().map(d => d.domain);
const domainExcluded = [];
if (excludedDomains.length > 0) {
  newUrls = newUrls.filter(url => {
    if (db.isUrlExcluded(url, excludedDomains)) {
      domainExcluded.push(url);
      return false;
    }
    return true;
  });
}

// Filter out URLs matching ignored tags (URL scope)
const ignoredUrls = [];
const ignoredTags = db.getAllIgnoredTags().filter(t => t.scope === 'url' || !t.scope);
if (ignoredTags.length > 0) {
  newUrls = newUrls.filter(url => {
    if (db.isUrlIgnored(url, ignoredTags)) {
      ignoredUrls.push(url);
      return false;
    }
    return true;
  });
}
```

### 2. AI Processor - Content Filtering

**File:** `ai-processor.js`

The AI processor filters sites based on ignored tags with content scope:

#### Content Scope Filtering
- Checks if site content matches ignored tags where `scope != 'url'`
- This includes:
  - Tags with `scope = 'content'`
  - Tags with `scope IS NULL` (applies to both URL and content)
- Uses `getIgnoredTags()` and `isContentIgnored()` methods
- Applied in `getPendingSites()` before AI processing

**Example:**
```javascript
// Filter out sites with ignored tags in content
const ignoredTags = this.getIgnoredTags();
const filtered = sites.filter(site => {
  if (!ignoredTags.length) return true;
  return !this.isContentIgnored(site.text_content, ignoredTags);
});

return filtered;
```

## Database Functions

### `db.isUrlIgnored(url, ignoredTags)`
Checks if a URL matches any ignored tags (URL scope).

**Parameters:**
- `url` (string): URL to check
- `ignoredTags` (array): Array of ignored tag objects

**Returns:** `boolean` - True if URL should be ignored

**Logic:**
- Skips tags with `scope = 'content'`
- Supports match types: `exact`, `regex`, `contains`

### `db.isContentIgnored(content, ignoredTags)`
Checks if content matches any ignored tags (content scope).

**Parameters:**
- `content` (string): Content text to check
- `ignoredTags` (array): Array of ignored tag objects

**Returns:** `boolean` - True if content should be ignored

**Logic:**
- Skips tags with `scope = 'url'`
- Supports match types: `exact`, `regex`, `contains`

### `db.isUrlExcluded(url, excludedDomainList)`
Checks if URL domain is in excluded domains list.

**Parameters:**
- `url` (string): URL to check
- `excludedDomainList` (array): Array of domain strings

**Returns:** `boolean` - True if domain is excluded

**Logic:**
- Extracts domain from URL
- Checks for exact match or subdomain match

## Scope Behavior

| Scope | URL Filtering | Content Filtering | Description |
|-------|--------------|-------------------|-------------|
| `url` | ✅ Yes | ❌ No | Only checks URL patterns |
| `content` | ❌ No | ✅ Yes | Only checks content text |
| `NULL` | ✅ Yes | ✅ Yes | Checks both URL and content |

## Match Types

| Match Type | Description | Example |
|-----------|-------------|---------|
| `exact` | Exact match | `example.com` matches `https://example.com` |
| `regex` | Regular expression | `\.gov\.` matches all .gov domains |
| `contains` | Substring match (default) | `blog` matches any URL containing "blog" |

## Console Output Examples

### Scraper Output:
```
Found 100 total URLs, 75 new to check, 20 already exist, 3 excluded by domain, 2 ignored by tags.

⛔ Excluded by domain:
  ⛔ https://example.com
  ⛔ https://spam-site.com
  ⛔ https://blocked-domain.org

🚫 Ignored by tags:
  🚫 https://blog.example.com
  🚫 https://forum.example.net
```

### AI Processor Output:
```
🤖 Processing batch of 5 sites...
   → [123] https://site.com...
   ⚡ FILTERED (Keyword "digital marketing" not found in URL, title, meta description, or content)
```

## Database Tables

### excluded_domains
```sql
CREATE TABLE excluded_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### ignored_tags
```sql
CREATE TABLE ignored_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL UNIQUE,
  match_type TEXT DEFAULT 'contains',
  scope TEXT DEFAULT 'url',
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Use Cases

### Example 1: Exclude Competitor Domains
```
Domain: competitor.com
Reason: Direct competitor
```
**Result:** All URLs from competitor.com are excluded during scraping.

### Example 2: Ignore Blog URLs
```
Tag: /blog/
Match Type: contains
Scope: url
Reason: Blogs don't have contact info
```
**Result:** Any URL containing `/blog/` is skipped during scraping.

### Example 3: Ignore Adult Content
```
Tag: casino|gambling|poker
Match Type: regex
Scope: content
Reason: Inappropriate content
```
**Result:** Sites with these keywords in content are filtered before AI processing.

### Example 4: Ignore Government Sites
```
Tag: .gov.
Match Type: contains
Scope: url
Reason: Government sites don't need outreach
```
**Result:** All .gov domains are excluded during scraping.

## Benefits

✅ **Prevents Wasted Resources**
- No scraping of excluded domains
- No AI processing of ignored content

✅ **Better Quality Leads**
- Filters out irrelevant sites early
- Focuses on target audience

✅ **Flexible Filtering**
- Multiple match types (exact, regex, contains)
- URL and content scope options
- Per-tag reasoning for tracking

✅ **Transparent Logging**
- Clear console output
- Shows what was filtered and why

## Status

✅ **COMPLETE** - Both scraper and AI processor now respect excluded domains and ignored tags

✅ **TESTED** - Filtering logic verified for all match types and scopes

✅ **DOCUMENTED** - Implementation details and usage examples provided

---

**The system now intelligently filters out unwanted domains and content at every stage!** 🎉
