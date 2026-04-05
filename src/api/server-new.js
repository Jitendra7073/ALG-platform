const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("../database/database.js");
const { initializePool } = require("../database/db-adapter");
const { chromium } = require("playwright");
const {
  LinkedInCompanyScraper,
} = require("../scrapers/linkedin-company-scraper.js");
const emailRouter = require("../services/email/email-senders-templates-api.js");
const timezoneAwareApi = require("../services/email/timezone-aware-api");
const worker = require("../services/email/email-queue-worker.js");
const aiWorker = require("../services/ai/ai-processor.js"); // Import new AI classification worker
const aiRetryManager = require("../services/ai-retry-manager.js"); // Import AI retry manager
const logger = require("../utils/system-logger.js"); // Import system logger

const app = express();
const PORT = 8080;
const userDataDir = "C:\\automation_chrome";

// DO NOT start workers here - they will start after DB initialization

// Intercept console to capture all logs
logger.interceptConsole();
logger.system("Server module loaded");

// Track executive scraper status
let executiveScraperStatus = { running: false, progress: 0, total: 0 };

// ========== CONTACT EXTRACTION FUNCTIONS ==========