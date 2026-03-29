/**
 * LinkedIn Company Scraper
 * Extracts founders, co-founders, and CEOs from LinkedIn company pages
 *
 * Features:
 * - Uses stored credentials from database
 * - Automatic login to LinkedIn
 * - Supports multiple credential accounts (only one active at a time)
 */

const { chromium } = require("playwright");
const path = require("path");
const db = require("./database");

// Delay configurations (in milliseconds)
const MIN_DELAY = 2000;
const MAX_DELAY = 4000;

// Random delay helper
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class LinkedInCompanyScraper {
  static context = null;
  static page = null;
  static currentCredential = null;

  /**
   * Initialize browser and login to LinkedIn using stored credentials
   */
  async init() {
    console.log("🔐 Initializing browser for LinkedIn company scraping...");

    // Get active credential from database
    const activeCredential = this.getActiveCredential();

    if (!activeCredential || !activeCredential.email || !activeCredential.password) {
      console.log("⚠️  No active LinkedIn credential found with email and password.");
      console.log("💡 Please add a LinkedIn credential in the admin panel:");
      console.log("   1. Go to http://localhost:8080");
      console.log("   2. Navigate to 'LinkedIn' tab");
      console.log("   3. Click 'Add Credential'");
      console.log("   4. Enter LinkedIn email and password");
      console.log("   5. Click the toggle to set it as active");
      throw new Error("No active LinkedIn credential found. Please add credentials in the admin panel.");
    }

    console.log(`📋 Using credential: ${activeCredential.name} (${activeCredential.email})`);
    this.currentCredential = activeCredential;

    // Use the same persistent context as WordPress detector
    this.context = await chromium.launchPersistentContext(
      "C:\\automation_chrome",
      {
        executablePath:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        headless: false,
        channel: "chrome",
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-infobars",
          "--profile-directory=Default",
        ],
        ignoreDefaultArgs: ["--disable-extensions"],
        viewport: { width: 1920, height: 1080 },
        locale: "en-US",
        timezoneId: "America/New_York",
        permissions: ["geolocation"],
      },
    );

    // Get or create page
    const pages = this.context.pages();
    if (pages.length > 0) {
      this.page = pages[0];
    } else {
      this.page = await this.context.newPage();
    }

    // Inject anti-detection scripts
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
      window.chrome = { runtime: {} };
    });

    console.log("✅ Browser context created successfully");

    // Login to LinkedIn
    await this.loginToLinkedIn(activeCredential);
  }

  /**
   * Get active LinkedIn credential from database
   */
  getActiveCredential() {
    const database = db.initDatabase();
    try {
      const credential = database.prepare(`
        SELECT * FROM linkedin_credentials
        WHERE is_active = 1
        ORDER BY last_used DESC
        LIMIT 1
      `).get();

      return credential || null;
    } finally {
      database.close();
    }
  }

  /**
   * Login to LinkedIn using credentials
   */
  async loginToLinkedIn(credential) {
    try {
      console.log("🔑 Logging in to LinkedIn...");

      // Go to LinkedIn login page
      console.log("   📄 Navigating to LinkedIn login page...");
      try {
        await this.page.goto("https://www.linkedin.com/login", {
          waitUntil: "domcontentloaded",
          timeout: 90000, // Increased from 30s to 90s
        });
      } catch (gotoError) {
        // Fallback: try with 'load' strategy if domcontentloaded fails
        console.log("⚠️  domcontentloaded timeout, trying with 'load' strategy...");
        await this.page.goto("https://www.linkedin.com/login", {
          waitUntil: "load",
          timeout: 60000,
        });
      }

      // Give page extra time to fully render
      await this.page.waitForTimeout(5000);

      // Debug: Check current state
      const currentUrl = this.page.url();
      const pageTitle = await this.page.title();
      console.log(`   📍 Current URL: ${currentUrl}`);
      console.log(`   📄 Page title: ${pageTitle}`);

      // Take screenshot for debugging
      await this.page.screenshot({ path: 'linkedin-page-loaded.png' });
      console.log("   📸 Screenshot saved to linkedin-page-loaded.png");

      // Check if already logged in
      if (!currentUrl.includes("login")) {
        console.log("✅ Already logged in to LinkedIn!");
        await this.markCredentialAsUsed();
        return;
      }

      // Debug: List all input elements on the page
      console.log("   🔍 Analyzing page structure...");
      const inputInfo = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const buttons = Array.from(document.querySelectorAll('button'));

        return {
          inputCount: inputs.length,
          inputs: inputs.map(input => ({
            type: input.type,
            id: input.id,
            name: input.name,
            className: input.className,
            placeholder: input.placeholder,
            visible: input.offsetParent !== null
          })),
          buttonCount: buttons.length,
          buttons: buttons.map(btn => ({
            type: btn.type,
            text: btn.textContent?.trim(),
            className: btn.className
          }))
        };
      });

      console.log(`   📊 Found ${inputInfo.inputCount} input elements:`);
      inputInfo.inputs.forEach((input, i) => {
        console.log(`      Input ${i + 1}: type="${input.type}", id="${input.id}", visible=${input.visible}`);
      });
      console.log(`   📊 Found ${inputInfo.buttonCount} buttons:`);
      inputInfo.buttons.forEach((btn, i) => {
        if (btn.text) console.log(`      Button ${i + 1}: type="${btn.type}", text="${btn.text}"`);
      });

      // Use the elements we found during analysis
      console.log("   ✨ Using discovered form elements...");

      // Get all inputs and filter for visible ones
      const allInputs = await this.page.$$("input");
      let emailField = null;
      let passwordField = null;

      // Find the first visible text/email input (that's the email field)
      for (const input of allInputs) {
        const type = await input.evaluate(el => el.type);
        const inputId = await input.evaluate(el => el.id || "");
        const visible = await input.evaluate(el => el.offsetParent !== null);

        // Look for email field - can be type="email" or type="text" with id="username"
        if (visible && !emailField) {
          if (type === 'email' || type === 'text' && inputId === 'username') {
            emailField = input;
            console.log(`   ✓ Found email field: type="${type}", id="${inputId}"`);
          }
        }

        if (type === 'password' && visible && !passwordField) {
          passwordField = input;
          console.log("   ✓ Found password field (visible password input)");
        }

        if (emailField && passwordField) break;
      }

      // If we couldn't find the fields, throw error with screenshot
      if (!emailField || !passwordField) {
        console.log("   ❌ Could not find login form fields");
        console.log(`      Email field found: ${emailField ? 'YES' : 'NO'}`);
        console.log(`      Password field found: ${passwordField ? 'YES' : 'NO'}`);
        await this.page.screenshot({ path: 'linkedin-no-form-fields.png' });
        throw new Error("Login form not found. LinkedIn may have changed their page layout or you need to complete verification manually.");
      }

      // Fill in email using the element handle we found
      console.log("   ⏳ Filling email field...");
      try {
        await emailField.fill(credential.email);
        console.log(`   ✓ Email entered: ${credential.email}`);
      } catch (fillError) {
        console.log("   ❌ Failed to fill email field:", fillError.message);
        await this.page.screenshot({ path: 'linkedin-fill-email-error.png' });
        throw fillError;
      }

      await this.page.waitForTimeout(randomDelay(500, 1000));

      // Fill in password using the element handle
      console.log("   ⏳ Filling password field...");
      try {
        await passwordField.fill(credential.password);
        console.log("   ✓ Password entered");
      } catch (fillError) {
        console.log("   ❌ Failed to fill password field:", fillError.message);
        await this.page.screenshot({ path: 'linkedin-fill-password-error.png' });
        throw fillError;
      }

      await this.page.waitForTimeout(randomDelay(500, 1000));

      // Find and click sign in button
      console.log("   🔍 Looking for Sign in button...");
      let buttonClicked = false;

      try {
        const buttons = await this.page.$$("button");
        console.log(`      Found ${buttons.length} buttons total`);

        // Detailed analysis of all buttons
        for (let i = 0; i < buttons.length; i++) {
          const buttonText = await buttons[i].evaluate(el => el.textContent || "");
          const trimmedText = buttonText.trim();
          const buttonClass = await buttons[i].evaluate(el => el.className || "");
          const buttonType = await buttons[i].evaluate(el => el.getAttribute('type') || '');

          if (trimmedText) {
            console.log(`      Button ${i + 1}: "${trimmedText}" (type="${buttonType}")`);
            console.log(`         Class snippet: ${buttonClass.substring(0, 50)}...`);
          }
        }

        console.log("\n   🎯 Trying multiple strategies to click Sign in button...\n");

        // STRATEGY 1: Exact text match "Sign in"
        console.log("   Strategy 1: Looking for exact text 'Sign in'...");
        for (let i = 0; i < buttons.length; i++) {
          const buttonText = await buttons[i].evaluate(el => el.textContent || "");
          const trimmedText = buttonText.trim();

          if (trimmedText === "Sign in") {
            console.log(`      → Found button ${i + 1} with exact text: "${trimmedText}"`);

            // Try multiple click methods
            try {
              // Method 1: Direct click
              await buttons[i].click();
              console.log("      ✓✓✓ CLICKED via direct click()!");
              buttonClicked = true;
              break;
            } catch (err1) {
              console.log(`      ⚠️  Direct click failed: ${err1.message}`);
              try {
                // Method 2: Click via JS
                await buttons[i].evaluate(el => el.click());
                console.log("      ✓✓✓ CLICKED via JS evaluate()!");
                buttonClicked = true;
                break;
              } catch (err2) {
                console.log(`      ⚠️  JS click failed: ${err2.message}`);
                try {
                  // Method 3: Click via focus + Enter
                  await buttons[i].focus();
                  await this.page.keyboard.press('Enter');
                  console.log("      ✓✓✓ CLICKED via focus + Enter!");
                  buttonClicked = true;
                  break;
                } catch (err3) {
                  console.log(`      ⚠️  Focus + Enter failed: ${err3.message}`);
                }
              }
            }
          }
        }

        // STRATEGY 2: Text match with innerText
        if (!buttonClicked) {
          console.log("\n   Strategy 2: Using innerText instead of textContent...");
          for (let i = 0; i < buttons.length; i++) {
            try {
              const innerText = await buttons[i].evaluate(el => el.innerText || "");
              if (innerText.trim() === "Sign in") {
                console.log(`      → Found via innerText, button ${i + 1}`);
                await buttons[i].click({ timeout: 5000 });
                console.log("      ✓✓✓ CLICKED via innerText match!");
                buttonClicked = true;
                break;
              }
            } catch (err) {
              // Skip this button
            }
          }
        }

        // STRATEGY 3: XPath selector
        if (!buttonClicked) {
          console.log("\n   Strategy 3: Using XPath to find button with text 'Sign in'...");
          try {
            const xpathButton = await this.page.waitForSelector("//button[contains(., 'Sign in') and not(contains(., 'Sign in with'))]", {
              timeout: 5000
            });
            await xpathButton.click();
            console.log("      ✓✓✓ CLICKED via XPath!");
            buttonClicked = true;
          } catch (xpathError) {
            console.log(`      ⚠️  XPath failed: ${xpathError.message}`);
          }
        }

        // STRATEGY 4: Get all buttons, filter in JS
        if (!buttonClicked) {
          console.log("\n   Strategy 4: Filtering buttons in browser context...");
          const buttonIndex = await this.page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            for (let i = 0; i < buttons.length; i++) {
              const text = buttons[i].textContent || buttons[i].innerText || "";
              if (text.trim() === "Sign in") {
                return i;
              }
            }
            return -1;
          });

          if (buttonIndex >= 0) {
            console.log(`      → Found button at index ${buttonIndex} in browser context`);
            const allButtons = await this.page.$$("button");
            await allButtons[buttonIndex].click();
            console.log("      ✓✓✓ CLICKED via browser context evaluation!");
            buttonClicked = true;
          }
        }

        // STRATEGY 5: Use Playwright's getByText with exact match
        if (!buttonClicked) {
          console.log("\n   Strategy 5: Using locator with exact text...");
          try {
            const locator = this.page.getByText("Sign in", { exact: true });
            await locator.click({ timeout: 5000 });
            console.log("      ✓✓✓ CLICKED via getByText exact match!");
            buttonClicked = true;
          } catch (locatorError) {
            console.log(`      ⚠️  getByText failed: ${locatorError.message}`);
          }
        }

        if (!buttonClicked) {
          await this.page.screenshot({ path: 'linkedin-button-not-found.png' });
          throw new Error("Failed to click Sign in button after trying all strategies");
        }

      } catch (buttonError) {
        console.log("   ❌ Failed to click sign-in button:", buttonError.message);
        console.log("   📸 Saving screenshot...");
        await this.page.screenshot({ path: 'linkedin-button-error.png', fullPage: true });
        throw buttonError;
      }

      // Wait for navigation or page load
      await this.page.waitForTimeout(3000);

      // Check for CAPTCHA or checkpoint
      const finalUrl = this.page.url();

      if (finalUrl.includes('checkpoint') || finalUrl.includes('verify') || finalUrl.includes('challenge')) {
        console.log('\n' + '='.repeat(70));
        console.log('🛑 SECURITY VERIFICATION DETECTED');
        console.log('='.repeat(70));
        console.log('\n📋 LinkedIn requires additional verification.');
        console.log('\n🔍 Possible reasons:');
        console.log('   • CAPTCHA challenge (image or puzzle)');
        console.log('   • Email verification required');
        console.log('   • Phone verification required');
        console.log('   • Unusual activity detected');
        console.log('\n✋ WHAT TO DO:');
        console.log('   1. Check the browser window (should be visible)');
        console.log('   2. Complete the verification process');
        console.log('   3. Enter code if sent to email/phone');
        console.log('   4. Solve CAPTCHA if presented');
        console.log('   5. Wait for redirect to LinkedIn feed');
        console.log('\n⏳ Scraper is PAUSED and waiting...');
        console.log('⏸️  DO NOT close the browser window');
        console.log('⏸️  You have 5 minutes to complete verification\n');

        // Wait for user to complete verification manually
        // Monitor URL for successful login (redirect away from checkpoint/verify)
        try {
          await this.page.waitForUrl(
            (url) => {
              return !url.includes('checkpoint') &&
                     !url.includes('verify') &&
                     !url.includes('challenge') &&
                     !url.includes('login') &&
                     (url.includes('feed') || url.includes('in/') || url.includes('company/'));
            },
            { timeout: 300000 } // 5 minutes
          );

          console.log('✅ Verification successful! Continuing...\n');

        } catch (timeoutError) {
          // Check if we're actually logged in despite timeout
          const finalCheckUrl = this.page.url();
          if (!finalCheckUrl.includes('login') && !finalCheckUrl.includes('checkpoint')) {
            console.log('✅ Verification appears successful (URL changed). Continuing...\n');
          } else {
            throw new Error('Verification timed out after 5 minutes. Please complete manual verification and try again.');
          }
        }
      } else if (finalUrl.includes("login")) {
        // Still on login page - likely wrong credentials or other error
        throw new Error("Login failed. Please check your email and password. If credentials are correct, LinkedIn may require additional verification.");
      } else {
        console.log("✅ Successfully logged in to LinkedIn!");
      }

      // Mark credential as used
      await this.markCredentialAsUsed();

    } catch (error) {
      console.error("❌ LinkedIn login failed:", error.message);
      throw new Error(`LinkedIn login failed: ${error.message}`);
    }
  }

  /**
   * Mark the current credential as used
   */
  async markCredentialAsUsed() {
    if (!this.currentCredential) return;

    const database = db.initDatabase();
    try {
      database.prepare(`
        UPDATE linkedin_credentials
        SET last_used = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(this.currentCredential.id);
      console.log("📊 Credential marked as used");
    } finally {
      database.close();
    }
  }

  async close() {
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    this.currentCredential = null;
  }

  /**
   * Check if we're logged in to LinkedIn
   */
  async isLoggedIn() {
    try {
      const currentUrl = this.page.url();
      return !currentUrl.includes("login") && !currentUrl.includes("checkpoint");
    } catch (error) {
      return false;
    }
  }

  /**
   * Ensure we're logged in before scraping
   */
  async ensureLoggedIn() {
    if (!this.context || !this.page || this.page.isClosed()) {
      await this.init();
      return;
    }

    const loggedIn = await this.isLoggedIn();
    if (!loggedIn) {
      console.log("🔄 Not logged in, re-authenticating...");
      await this.loginToLinkedIn(this.currentCredential);
    }
  }

  /**
   * Scrape company LinkedIn page for executives
   * @param {string} companyUrl - LinkedIn company URL
   * @param {number} siteId - Database site ID
   * @returns {Object} Scraping results
   */
  async scrapeCompanyPage(companyUrl, siteId) {
    try {
      console.log(`\n🏢 Scraping company: ${companyUrl}`);

      // Ensure we're logged in
      await this.ensureLoggedIn();

      // Check if browser context is still valid
      if (!this.context || this.context.browser()?.isConnected() === false) {
        console.log(`⚠️  Browser context closed, reinitializing...`);
        await this.init();
      }

      // Check if page is still valid
      if (!this.page || this.page.isClosed()) {
        console.log(`⚠️  Page closed, creating new page...`);
        const pages = this.context.pages();
        if (pages.length > 0) {
          this.page = pages[0];
        } else {
          this.page = await this.context.newPage();
        }
      }

      // Build the executives search URL directly
      // Pattern: {companyUrl}/people/?keywords=founder%2C%20co-founder%2C%20ceo%2C%20cto
      const peopleUrl =
        companyUrl.replace(/\/$/, "") +
        "/people/?keywords=founder%2C%20co-founder%2C%20ceo%2C%20cto";
      console.log(`👥 Direct URL: ${peopleUrl}`);

      // Navigate directly to the filtered people page
      console.log(`📄 Navigating to filtered people page...`);
      await this.page.goto(peopleUrl, {
        waitUntil: "domcontentloaded",
        timeout: 90000, // Increased to 90 seconds
      });

      // Wait for page to load
      await this.page.waitForTimeout(randomDelay(3000, 5000));

      // Check if we're logged in
      const currentUrl = this.page.url();
      if (currentUrl.includes("login") || currentUrl.includes("checkpoint")) {
        throw new Error("Not logged in to LinkedIn. Please login first.");
      }

      // Wait for results to load
      console.log(`⏳ Waiting for people results to load...`);
      try {
        await this.page.waitForSelector(
          'a[href*="/in/"], .org-people-profile-card, .entity-result__item',
          {
            timeout: 10000,
          },
        );
        console.log(`✅ People results loaded`);
      } catch (e) {
        console.log(
          `⚠️  Could not detect people results, continuing anyway...`,
        );
      }

      // Extract company name from the page
      const companyInfo = await this.extractCompanyInfo();
      console.log(`📊 Company: ${companyInfo.name || "Unknown"}`);

      // Debug: Check what's on the page
      const pageInfo = await this.page.evaluate(() => {
        return {
          totalLinks: document.querySelectorAll("a").length,
          profileLinks: document.querySelectorAll('a[href*="/in/"]').length,
          title: document.title,
          url: window.location.href,
        };
      });
      console.log(`📊 Page info:`, pageInfo);

      // Extract executives from the people page
      const allExecutives = await this.extractExecutives();
      console.log(`📋 Raw matches found: ${allExecutives.length}`);

      // Post-process: select exactly up to 3 founders + 1 CEO + 1 CTO
      const executives = this.selectStructuredExecutives(allExecutives);
      console.log(`✅ Selected ${executives.length} structured executives (3 Founders + 1 CEO + 1 CTO)`);

      // Save to database
      const saved = await this.saveExecutivesToDatabase(
        siteId,
        companyUrl,
        companyInfo,
        executives,
      );

      return {
        success: true,
        companyUrl,
        companyName: companyInfo.name,
        executivesFound: executives.length,
        executivesSaved: saved,
      };
    } catch (error) {
      console.error(`❌ Error scraping company page: ${error.message}`);
      return {
        success: false,
        companyUrl,
        error: error.message,
      };
    }
  }

  /**
   * Post-process raw executives list to select structured roles:
   * - Up to 3 Founders (priority: founder > co-founder > owner)
   * - 1 CEO
   * - 1 CTO
   * Same person can appear in both founder and CEO/CTO slots.
   * @param {Array} allExecutives - Raw extracted executives
   * @returns {Array} - Filtered executives (max 5)
   */
  selectStructuredExecutives(allExecutives) {
    const selected = [];

    // 1. Select CEO (first match)
    const ceo = allExecutives.find((e) => e.roleCategory === "ceo");
    if (ceo) {
      selected.push(ceo);
      console.log(`   👔 CEO: ${ceo.name || "Unknown"}`);
    }

    // 2. Select CTO (first match)
    const cto = allExecutives.find((e) => e.roleCategory === "cto");
    if (cto) {
      selected.push(cto);
      console.log(`   💻 CTO: ${cto.name || "Unknown"}`);
    }

    // 3. Select up to 3 founders with priority: founder > co-founder > owner
    const founderPriority = ["founder", "co-founder", "owner"];
    const founders = [];

    for (const role of founderPriority) {
      if (founders.length >= 3) break;
      const matches = allExecutives.filter((e) => e.roleCategory === role);
      for (const match of matches) {
        if (founders.length >= 3) break;
        // Allow same person in both founder + CEO/CTO slots (don't deduplicate)
        founders.push(match);
        console.log(`   🏗️ Founder ${founders.length}: ${match.name || "Unknown"} (${match.roleCategory})`);
      }
    }

    // Add founders that aren't already selected (by profileUrl)
    for (const founder of founders) {
      const alreadyAdded = selected.some(
        (s) => s.profileUrl === founder.profileUrl
      );
      if (!alreadyAdded) {
        selected.push(founder);
      }
    }

    console.log(`   📊 Structure: ${founders.length} Founder(s), ${ceo ? 1 : 0} CEO, ${cto ? 1 : 0} CTO`);

    return selected;
  }

  /**
   * Extract basic company information
   */
  async extractCompanyInfo() {
    return await this.page.evaluate(() => {
      // Extract company name from multiple sources
      let name = "";

      // Try h1
      const h1 = document.querySelector("h1");
      if (h1) {
        name = h1.textContent.trim();
      }

      // Try title as fallback
      if (!name && document.title) {
        const titleParts = document.title.split("|");
        if (titleParts.length > 0) {
          name = titleParts[0].trim();
        }
      }

      // Extract follower count if available
      const followerElement = document.querySelector(
        '[data-anonymize="company-employees-count"]',
      );
      const followers = followerElement
        ? followerElement.textContent.trim()
        : "";

      // Extract industry
      const industryElement = document.querySelector(
        '[data-anonymize="company-industry"]',
      );
      const industry = industryElement
        ? industryElement.textContent.trim()
        : "";

      return {
        name,
        followers,
        industry,
      };
    });
  }

  /**
   * Extract executives (founders, co-founders, CEOs) from people page
   */
  async extractExecutives() {
    return await this.page.evaluate(() => {
      const executives = [];

      // Target keywords in headlines
      const targetKeywords = [
        "founder",
        "co-founder",
        "cofounder",
        "ceo",
        "chief executive officer",
        "cto",
        "chief technology officer",
        "owner",
        "president",
        "managing director",
        "md",
        "partner",
      ];

      // Debug: Log what we're finding
      console.log("[LinkedIn Scraper] Searching for executives...");

      // Method 1: Try multiple card selectors
      const cardSelectors = [
        ".org-people-profile-card__profile-info",
        ".pv5",
        ".entity-result__item",
        "li[data-urn]",
        '[data-urn*="person"]',
        ".ppl-list-header",
        ".artdeco-list__item",
      ];

      let allCards = [];
      for (const selector of cardSelectors) {
        const cards = document.querySelectorAll(selector);
        if (cards.length > 0) {
          console.log(
            `[LinkedIn Scraper] Found ${cards.length} cards with selector: ${selector}`,
          );
          allCards = Array.from(cards);
          break;
        }
      }

      // Method 2: If no cards found, look for ALL profile links
      if (allCards.length === 0) {
        console.log(
          "[LinkedIn Scraper] No cards found, looking for profile links...",
        );
        allCards = Array.from(document.querySelectorAll('a[href*="/in/"]'))
          .map((link) => link.closest("div, li, artdeco-entity"))
          .filter((el) => el !== null);
        console.log(
          `[LinkedIn Scraper] Found ${allCards.length} potential containers`,
        );
      }

      // Process each card/container
      allCards.forEach((card, index) => {
        try {
          // Get profile link - try multiple approaches
          let profileLink = card.querySelector('a[href*="/in/"]');

          // If not in card, look in nearby elements
          if (!profileLink) {
            const allLinks =
              card.parentElement?.querySelectorAll('a[href*="/in/"]') || [];
            profileLink = allLinks[0];
          }

          if (!profileLink) {
            console.log(
              `[LinkedIn Scraper] Card ${index}: No profile link found`,
            );
            return;
          }

          const profileUrl = profileLink.href.split("?")[0].split("#")[0];
          console.log(
            `[LinkedIn Scraper] Card ${index}: Found profile ${profileUrl}`,
          );

          // Get name - try multiple selectors
          let name = "";
          const nameSelectors = [
            '[data-anonymize="person-name"]',
            ".artdeco-entity-lockup__title",
            ".entity-result__title",
            'a[href*="/in/"]',
            ".text-heading-xlarge",
            "h1",
            "h2",
            "h3",
          ];

          for (const selector of nameSelectors) {
            const nameElement = card.querySelector(selector);
            if (
              nameElement &&
              nameElement.textContent &&
              nameElement.textContent.trim().length > 0
            ) {
              name = nameElement.textContent.trim();
              // If it's the link itself, it might just be "View profile", so check
              if (
                name.toLowerCase().includes("view") &&
                name.toLowerCase().includes("profile")
              ) {
                name = "";
                continue;
              }
              break;
            }
          }

          // Get headline/subtitle - try multiple selectors
          let headline = "";
          const headlineSelectors = [
            '[data-anonymize="person-role"]',
            ".artdeco-entity-lockup__subtitle",
            ".entity-result__summary",
            ".entity-result__content-sub",
            ".ppl-list-header__subtitle",
            ".text-body-medium",
          ];

          for (const selector of headlineSelectors) {
            const headlineElement = card.querySelector(selector);
            if (headlineElement && headlineElement.textContent) {
              headline = headlineElement.textContent.trim().toLowerCase();
              break;
            }
          }

          // Also try to get headline from text content around the profile link
          if (!headline) {
            const parent = profileLink.closest("div, li, artdeco-entity");
            if (parent) {
              const text = parent.textContent || "";
              headline = text.toLowerCase();
            }
          }

          console.log(
            `[LinkedIn Scraper] Card ${index}: Name="${name}", Headline="${headline}"`,
          );

          // Check if headline contains target keywords
          const hasTargetKeyword = targetKeywords.some((keyword) =>
            headline.includes(keyword.toLowerCase()),
          );

          if (hasTargetKeyword) {
            // Determine role category
            let roleCategory = "other";
            const fullHeadline = headline || "";

            if (
              fullHeadline.includes("co-founder") ||
              fullHeadline.includes("cofounder")
            ) {
              roleCategory = "co-founder";
            } else if (fullHeadline.includes("founder")) {
              roleCategory = "founder";
            } else if (
              fullHeadline.includes("ceo") ||
              fullHeadline.includes("chief executive")
            ) {
              roleCategory = "ceo";
            } else if (
              fullHeadline.includes("cto") ||
              fullHeadline.includes("chief technology")
            ) {
              roleCategory = "cto";
            } else if (fullHeadline.includes("president")) {
              roleCategory = "president";
            } else if (fullHeadline.includes("owner")) {
              roleCategory = "owner";
            } else if (
              fullHeadline.includes("managing director") ||
              fullHeadline.includes("md")
            ) {
              roleCategory = "md";
            } else if (fullHeadline.includes("partner")) {
              roleCategory = "partner";
            }

            executives.push({
              profileUrl,
              name: name || null,
              headline: headline || null,
              roleCategory,
            });

            console.log(
              `[LinkedIn Scraper] ✅ Added: ${name} (${roleCategory})`,
            );
          }
        } catch (e) {
          console.log(`[LinkedIn Scraper] Card ${index} error:`, e.message);
        }
      });

      console.log(
        `[LinkedIn Scraper] Total executives found: ${executives.length}`,
      );

      return executives;
    });
  }

  /**
   * Save executives to database
   */
  async saveExecutivesToDatabase(siteId, companyUrl, companyInfo, executives) {
    const db = require("./database");

    let savedCount = 0;

    for (const exec of executives) {
      const result = db.saveExecutive({
        site_id: siteId,
        company_url: companyUrl,
        company_name: companyInfo.name || null,
        profile_url: exec.profileUrl,
        name: exec.name || null,
        headline: exec.headline || null,
        role_category: exec.roleCategory || null,
      });

      if (result.success) {
        savedCount++;
        console.log(
          `   💾 Saved: ${exec.name || "Unknown"} (${exec.roleCategory || "Unknown"})`,
        );
      } else if (result.error === "Profile already exists") {
        console.log(`   ⊗ Already exists: ${exec.name || "Unknown"}`);
      } else {
        console.log(`   ⚠️  Error saving: ${result.error}`);
      }
    }

    return savedCount;
  }

  /**
   * Process all LinkedIn company URLs from the database
   */
  async processAllCompanyUrls() {
    const db = require("./database");
    const database = db.initDatabase();

    try {
      // Get all LinkedIn URLs from contacts table, excluding those that already have executives
      const companyUrls = database
        .prepare(
          `
        SELECT DISTINCT
          c.value as linkedin_url,
          c.site_id,
          s.url as site_url
        FROM contacts c
        INNER JOIN sites s ON c.site_id = s.id
        WHERE c.type = 'linkedin'
          AND NOT EXISTS (
            SELECT 1 FROM company_executives ce
            WHERE ce.company_url = c.value
          )
      `,
        )
        .all();

      database.close();

      console.log(
        `\n📊 Found ${companyUrls.length} LinkedIn company URLs to process (skipping companies with existing executives)`,
      );

      if (companyUrls.length === 0) {
        console.log(`✅ All companies already have executives scraped!`);
        return [];
      }

      const results = [];

      for (let i = 0; i < companyUrls.length; i++) {
        const company = companyUrls[i];
        console.log(`\n${"=".repeat(70)}`);
        console.log(
          `[${i + 1}/${companyUrls.length}] Processing: ${company.linkedin_url}`,
        );
        console.log(`   From site: ${company.site_url}`);

        const result = await this.scrapeCompanyPage(
          company.linkedin_url,
          company.site_id,
        );
        results.push({
          ...result,
          siteUrl: company.site_url,
        });

        // Delay between companies
        if (i < companyUrls.length - 1) {
          const delay = randomDelay(5000, 8000);
          console.log(`⏱️  Waiting ${delay}ms before next company...`);
          await this.page.waitForTimeout(delay);
        }
      }

      // Summary
      console.log(`\n${"=".repeat(70)}`);
      console.log("📊 SUMMARY:");
      console.log(`   Total companies processed: ${companyUrls.length}`);
      console.log(`   Successful: ${results.filter((r) => r.success).length}`);
      console.log(`   Failed: ${results.filter((r) => !r.success).length}`);

      const totalExecutives = results
        .filter((r) => r.success)
        .reduce((sum, r) => sum + (r.executivesFound || 0), 0);

      console.log(`   Total executives found: ${totalExecutives}`);

      return results;
    } finally {
      database.close();
    }
  }
}

// Export functions
module.exports = {
  LinkedInCompanyScraper,
  scrapeCompanyUrls: async () => {
    const scraper = new LinkedInCompanyScraper();
    try {
      return await scraper.processAllCompanyUrls();
    } finally {
      await scraper.close();
    }
  },
};
