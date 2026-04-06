/**
 * Simple Vercel Serverless Function
 * Minimal implementation for immediate deployment
 */

const express = require("express");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check (important for Vercel)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Simple API test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API is working',
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Serve static files
app.use(express.static('public'));

// SPA fallback - serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile('public/index.html', { root: __dirname });
});

// Export for Vercel
module.exports = app;
