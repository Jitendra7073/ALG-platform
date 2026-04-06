/**
 * Vercel Serverless Function Entry Point
 *
 * This file serves as the entry point for Vercel deployment.
 * It handles the differences between local development and Vercel serverless environment.
 */

const express = require("express");
const cors = require("cors");

// Create Express app for Vercel
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for Vercel
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Import and use the main server routes
const { apiServer } = require('../src/api/server.js');

// Mount all routes from the main server
app.use('/', apiServer);

// Export for Vercel
module.exports = app;
