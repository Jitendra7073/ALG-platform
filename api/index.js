/**
 * Vercel Serverless Function Entry Point
 *
 * This file serves as the entry point for Vercel deployment.
 * It creates a serverless-compatible Express app without browser/background workers.
 */

const express = require("express");
const cors = require("cors");
const path = require("path");

// Create Express app for Vercel
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for Vercel
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: 'vercel'
  });
});

// Import the main Express app from server.js
// The server.js exports 'apiServer' which contains all routes
const { apiServer } = require('../src/api/server.js');

// Mount all routes from the main server
app.use('/', apiServer);

// SPA fallback for client-side routing - must be last
app.all('*', (req, res, next) => {
  // Don't intercept API routes or health endpoint
  if (req.path.startsWith('/api') || req.path === '/health') {
    return next(); // Let apiServer handle it
  }
  // Serve index.html for all other routes (SPA fallback)
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Export for Vercel serverless

module.exports = app;
