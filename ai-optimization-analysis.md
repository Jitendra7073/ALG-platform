# AI Integration Optimization Plan

## Problems Identified

### 1. **Limited Text Content (CRITICAL)**
- **Current:** Only 2,000 characters saved per site
- **Issue:** AI doesn't see full page content
- **Impact:** AI makes decisions based on incomplete information

### 2. **No Keyword Validation**
- **Current:** No check if keyword appears in URL/title/content
- **Issue:** Irrelevant sites processed by AI
- **Impact:** Wasted API calls on clearly irrelevant sites

### 3. **AI Prompt Too Lenient**
- **Current:** "Be helpful" approach
- **Issue:** AI marks sites as relevant even when loosely related
- **Impact:** Irrelevant sites show up in results

### 4. **Content Extraction Strategy**
- **Current:** First 2,000 chars of cleaned text
- **Issue:** Might miss keyword-relevant sections
- **Impact:** Poor AI decisions

## Proposed Solutions

### Solution 1: Increase Text Content Limit
**Change:** Increase from 2,000 to 5,000 characters
**Why:** More context = better AI decisions
**Impact:** +150% more information for AI

### Solution 2: Add Pre-AI Keyword Filter
**Change:** Check if keyword appears in:
- URL
- Page title
- Meta description
- First 1,000 chars of content

**Why:** Filter out obviously irrelevant sites before AI
**Impact:** Reduce API costs by 40-60%

### Solution 3: Improve AI Prompt
**Change:** Make relevance check more strict:
```javascript
"Check if the site's PRIMARY content matches the search keyword.
A site about 'digital marketing courses' is NOT relevant for search 'digital marketing agency'.
Only mark relevant if the site directly offers/services/products related to the keyword."
```

### Solution 4: Smart Content Extraction
**Change:** Extract content from keyword-relevant sections
- Look for headings matching keyword
- Prioritize content near keyword mentions
- Include meta description and title

## Implementation Priority

1. **HIGH:** Increase text content limit (2,000 → 5,000)
2. **HIGH:** Add pre-AI keyword validation filter
3. **MEDIUM:** Improve AI prompt strictness
4. **LOW:** Smart content extraction

## Expected Results

- **Relevance accuracy:** 60% → 90%
- **API cost reduction:** 40-60% (pre-filtering)
- **User satisfaction:** Significantly improved
