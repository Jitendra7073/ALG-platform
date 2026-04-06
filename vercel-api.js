/**
 * Vercel Serverless API Entry Point
 *
 * This is the main entry point for Vercel deployment.
 * It imports the Express app from the main server and adapts it for serverless execution.
 */

const express = require("express");
const cors = require("cors");

// Create Express app
const app = express();

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (required by Vercel)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Import and mount the main application routes
const { apiServer } = require('../src/api/server.js');

// Copy all middleware and routes from main server
app.use('/', apiServer);

// Export for Vercel serverless functions
module.exports = app;
