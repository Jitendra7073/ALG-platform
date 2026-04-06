/**
 * Vercel Serverless Function Entry Point
 * Clean implementation for Vercel deployment
 */

const express = require("express");
const cors = require("cors");
const path = require("path");

// Create Express app
const app = express();

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    message: 'API is running'
  });
});

// API routes placeholder
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: 'Email automation API is running',
    timestamp: new Date().toISOString()
  });
});

// Catch all route for serving the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Export for Vercel serverless functions
module.exports = app;