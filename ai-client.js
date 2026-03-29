/**
 * AI Client - Single OpenRouter Integration
 * 
 * Two focused tasks:
 * 1. Verify if a site is actually WordPress
 * 2. Check if content is relevant to domain/keyword + provide summary
 */
require("dotenv").config();

// Valid free models on OpenRouter (as of Feb 2026)
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

class AIClient {
  constructor() {
    this.client = null;
    this.stats = {
      totalRequests: 0,
      totalTokens: 0,
      errors: 0,
      lastRequest: null,
    };
  }

  /**
   * Initialize OpenAI client (lazy loading)
   */
  async getClient() {
    if (!this.client) {
      const { OpenAI } = await import("openai");
      this.client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
        defaultHeaders: {
          "HTTP-Referer": "http://localhost:8080",
          "X-Title": "WordPress Lead Generator",
        },
      });
    }
    return this.client;
  }

  /**
   * Check if API key is configured
   */
  isConfigured() {
    return !!process.env.OPENROUTER_API_KEY;
  }

  /**
   * Chat completion with JSON response
   */
  async chatJSON(systemPrompt, userMessage, options = {}) {
    const client = await this.getClient();
    const startTime = Date.now();

    try {
      const response = await client.chat.completions.create({
        model: options.model || MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: options.temperature || 0.1,
        max_tokens: options.maxTokens || 1000,
      });

      this.stats.totalRequests++;
      this.stats.totalTokens += response.usage?.total_tokens || 0;
      this.stats.lastRequest = new Date().toISOString();

      const content = response.choices[0].message.content;

      // Parse JSON response
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        // Try extracting JSON from markdown code block
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1].trim());
        } else {
          throw new Error(`Failed to parse JSON: ${content.substring(0, 200)}...`);
        }
      }

      return {
        content: parsed,
        usage: response.usage,
        responseTime: Date.now() - startTime,
        model: MODEL,
      };
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }


  /**
   * TASK 2: Check Content Relevance + Generate Summary
   * 
   * Verifies if the site's actual content matches the search keyword intent.
   * Example: A URL like "ajio-coupons" should have coupon content, not cashback.
   * 
   * @param {string} searchKeyword - The keyword used to find this site
   * @param {string} siteUrl - The URL of the site
   * @param {string} textContent - Scraped text content
   * @returns {Promise<{isRelevant: boolean, actualCategory: string, summary: string, mismatchReason: string|null}>}
   */
  async checkContentRelevance(searchKeyword, siteUrl, textContent) {
    const systemPrompt = `You are an AI analyst for a lead generation system. Your job is to verify if a website's ACTUAL content matches the search keyword intent.

**Guidance:**
- Be helpful: If the site has a dedicated page or section for the keyword (even if it's a large portal), it is RELEVANT.
- Many coupon sites also offer "cashback" or "rewards" - this is normal. Do NOT mark as mismatch just because they offer cashback, UNLESS they offer NO coupons at all.
- A "coupons" site that actually lists many store discounts is RELEVANT.

PREDEFINED CATEGORIES (you MUST pick exactly one):
"Digital Marketing", "E-commerce", "Web Development", "Agency", "Blog", "Education", "Technology", "SaaS", "Finance", "Healthcare", "Real Estate", "News & Media", "Legal Services", "Consulting", "Non-profit", "Entertainment", "Travel & Hospitality", "Automotive", "Fashion & Beauty", "Food & Restaurant", "Manufacturing", "Coupons & Deals", "Cashback & Rewards", "Photography", "Sports & Fitness", "Other"

Return JSON:
{
  "isRelevant": true/false,
  "actualCategory": "One of the predefined categories above that best fits the site",
  "summary": "2-3 sentence description of what the site ACTUALLY offers/does",
  "mismatchReason": "If not relevant, explain why" or null if relevant
}`;

    const userMessage = `SEARCH KEYWORD: "${searchKeyword}"
SITE URL: ${siteUrl}

WEBSITE CONTENT:
${textContent.substring(0, 4000)}

Analyze if the actual content matches the search keyword intent.`;

    const result = await this.chatJSON(systemPrompt, userMessage);
    return result.content;
  }

  /**
   * AI Analysis for a WordPress site
   *
   * Performs TWO tasks:
   * 1. WordPress Verification - Confirms if site is actually built with WordPress
   * 2. Content Relevance Check - Verifies if content matches search keyword intent
   *
   * @param {string} searchKeyword - The keyword used to find this site
   * @param {string} siteUrl - The URL of the site
   * @param {string} textContent - Scraped text content
   * @param {string} pageTitle - Page title
   * @param {string} metaDescription - Meta description
   * @returns {Promise<Object>} Complete analysis result with WordPress verification and content relevance
   */
  async analyzeSite(searchKeyword, siteUrl, textContent, pageTitle = '', metaDescription = '') {
    const systemPrompt = `You are an AI analyst for a WordPress lead generation system.
Analyze this website and provide TWO assessments:

**TASK 1: WordPress Verification**
Determine if this website is ACTUALLY built with WordPress.
Look for:
- WordPress-specific URLs (/wp-content/, /wp-includes/, /wp-admin/, /wp-json/)
- WordPress meta generator tags (e.g., "WordPress 6.x")
- WordPress-specific CSS classes (wp-block-, wp-element-, etc.)
- WordPress themes and plugins structure
- WordPress REST API endpoints
- wp-emoji-release.min.js or similar WordPress scripts

**TASK 2: Content Relevance Check (STRICT)**
IMPORTANT: Be STRICT when determining relevance. The search keyword represents what the user is LOOKING FOR.

Rules:
1. The site must DIRECTLY offer products/services/content matching the search keyword
2. A blog post ABOUT a topic is NOT the same as offering that service
   - "About digital marketing" blog ≠ Digital Marketing Agency
   - "Benefits of yoga" article ≠ Yoga Studio
3. Educational content about a topic ≠ Service provider for that topic
   - "How to learn photography" course ≠ Photography Studio
4. Only mark as relevant if the site PRIMARLY offers/services the keyword

Examples of NOT relevant:
- Search: "digital marketing agency" → Site: "Digital marketing blog" → NOT relevant (blog, not agency)
- Search: "yoga studio" → Site: "Benefits of yoga article" → NOT relevant (article, not studio)
- Search: "web development" → Site: "Learn web development course" → NOT relevant (course, not service)

Examples of RELEVANT:
- Search: "digital marketing" → Site: "Digital marketing agency" → Relevant (direct match)
- Search: "coupons" → Site: "Coupon deals website" → Relevant (direct match)
- Search: "yoga classes" → Site: "Yoga studio offering classes" → Relevant (direct match)

**PREDEFINED CATEGORIES (you MUST pick exactly one):**
"Digital Marketing", "E-commerce", "Web Development", "Agency", "Blog", "Education",
"Technology", "SaaS", "Finance", "Healthcare", "Real Estate", "News & Media",
"Legal Services", "Consulting", "Non-profit", "Entertainment", "Travel & Hospitality",
"Automotive", "Fashion & Beauty", "Food & Restaurant", "Manufacturing",
"Coupons & Deals", "Cashback & Rewards", "Photography", "Sports & Fitness", "Other"

**Return JSON:**
{
  "wordpressVerification": {
    "isWordPress": true/false,
    "confidence": "high"/"medium"/"low",
    "indicators": ["array of WordPress indicators found OR reasons why not WordPress"]
  },
  "contentRelevance": {
    "isRelevant": true/false,
    "actualCategory": "One of the predefined categories",
    "summary": "2-3 sentence description of what the site ACTUALLY does (be honest)",
    "mismatchReason": "If not relevant, explain WHY it doesn't match the search keyword intent"
  }
}`;

    // Build content with metadata for better context
    let content = `SEARCH KEYWORD: "${searchKeyword}"
SITE URL: ${siteUrl}`;

    if (pageTitle) {
      content += `\nPAGE TITLE: ${pageTitle}`;
    }

    if (metaDescription) {
      content += `\nMETA DESCRIPTION: ${metaDescription}`;
    }

    content += `\n\nWEBSITE CONTENT:
${textContent.substring(0, 5000)}`;

    const userMessage = content;

    const result = await this.chatJSON(systemPrompt, userMessage);

    return {
      ...result.content,
      responseTime: result.responseTime,
      tokensUsed: result.usage?.total_tokens || 0,
    };
  }

  /**
   * Get client statistics
   */
  getStats() {
    return {
      ...this.stats,
      model: MODEL,
      configured: this.isConfigured(),
    };
  }
}

// Export singleton
module.exports = new AIClient();
