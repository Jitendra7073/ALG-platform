#!/usr/bin/env node

/**
 * API Test Script
 *
 * Tests all major API endpoints to verify they return data correctly.
 * Usage: node src/scripts/test-api.js
 *
 * The server must be running on port 8080 before running this script.
 * Start it with: npm run admin
 */

const BASE_URL = 'http://localhost:8080';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Test endpoints configuration
const endpoints = [
  {
    name: 'Keywords',
    path: '/api/keywords',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Sites (All)',
    path: '/api/sites/all',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Stats',
    path: '/api/stats',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Searches',
    path: '/api/searches',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Excluded Domains',
    path: '/api/excluded-domains',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Ignored Tags',
    path: '/api/ignored-tags',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'WordPress Sites',
    path: '/api/sites/wordpress',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Non-WordPress Sites',
    path: '/api/sites/non-wordpress',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Sites Categories',
    path: '/api/sites/categories',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'AI Stats',
    path: '/api/ai/stats',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'AI Providers',
    path: '/api/ai/providers',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'AI History',
    path: '/api/ai/history',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'AI Processor Stats',
    path: '/api/ai/processor/stats',
    expectedFields: ['success'],
  },
  {
    name: 'Contacts Stats',
    path: '/api/contacts/stats',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Contacts Emails',
    path: '/api/contacts/emails',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Contacts Phones',
    path: '/api/contacts/phones',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Contacts LinkedIn',
    path: '/api/contacts/linkedin',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Contacts All',
    path: '/api/contacts/all',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Executives Stats',
    path: '/api/executives/stats',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Executives',
    path: '/api/executives',
    expectedFields: ['success', 'data'],
  },
  {
    name: 'Executives Structured',
    path: '/api/executives/structured',
    expectedFields: ['success', 'data'],
  },
];

/**
 * Print a formatted message to the console
 */
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Print a section header
 */
function printHeader(title) {
  console.log('');
  log('='.repeat(60), 'cyan');
  log(`  ${title}`, 'bright');
  log('='.repeat(60), 'cyan');
}

/**
 * Print a test result
 */
function printTestResult(endpoint, status, details = '') {
  const statusSymbol = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠';
  const statusColor = status === 'PASS' ? 'green' : status === 'FAIL' ? 'red' : 'yellow';

  log(`  ${statusSymbol} ${endpoint}`, statusColor);
  if (details) {
    console.log(`    ${details}`);
  }
}

/**
 * Check if response has expected fields
 */
function validateResponseStructure(data, expectedFields) {
  const missingFields = [];
  const presentFields = [];

  for (const field of expectedFields) {
    if (field in data) {
      presentFields.push(field);
    } else {
      missingFields.push(field);
    }
  }

  return { presentFields, missingFields };
}

/**
 * Count items in response data
 */
function countResponseItems(data) {
  const itemCounts = {};

  if (Array.isArray(data)) {
    itemCounts['items'] = data.length;
  } else if (typeof data === 'object' && data !== null) {
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) {
        itemCounts[key] = data[key].length;
      }
    }
  }

  return itemCounts;
}

/**
 * Format JSON for display
 */
function formatJson(data, maxLines = 5) {
  const json = JSON.stringify(data, null, 2);
  const lines = json.split('\n');
  if (lines.length <= maxLines) {
    return json;
  }
  return lines.slice(0, maxLines).join('\n') + '\n  ...';
}

/**
 * Test a single endpoint
 */
async function testEndpoint(endpoint) {
  const url = `${BASE_URL}${endpoint.path}`;

  try {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type');

    if (!response.ok) {
      return {
        status: 'FAIL',
        details: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    if (!contentType || !contentType.includes('application/json')) {
      return {
        status: 'FAIL',
        details: `Expected JSON, got ${contentType || 'unknown content type'}`,
      };
    }

    const data = await response.json();

    // Validate structure if expected fields are defined
    if (endpoint.expectedFields) {
      const { presentFields, missingFields } = validateResponseStructure(data, endpoint.expectedFields);

      if (missingFields.length > 0) {
        return {
          status: 'PARTIAL',
          details: `Missing fields: ${missingFields.join(', ')}`,
          data: { presentFields, missingFields },
        };
      }
    }

    // Count items in the response
    // Handle both {success: true, data: ...} and direct data responses
    let dataToCount = data;
    if (data.success && data.data !== undefined) {
      dataToCount = data.data;
    }
    const itemCounts = countResponseItems(dataToCount);

    return {
      status: 'PASS',
      details: `HTTP ${response.status}`,
      data: itemCounts,
    };

  } catch (error) {
    return {
      status: 'FAIL',
      details: error.message,
    };
  }
}

/**
 * Check if server is running
 */
async function checkServer() {
  try {
    const response = await fetch(BASE_URL, { method: 'HEAD' });
    return response.ok || response.status === 404; // 404 is ok, means server is running
  } catch (error) {
    return false;
  }
}

/**
 * Main test execution
 */
async function main() {
  printHeader('API Endpoint Test Suite');

  // Check if server is running
  log('Checking if server is running...', 'yellow');
  const serverRunning = await checkServer();

  if (!serverRunning) {
    log('ERROR: Server is not running!', 'red');
    log('Please start the server with: npm run admin', 'yellow');
    log('Then run this script again.', 'yellow');
    process.exit(1);
  }

  log('Server is running.', 'green');

  printHeader('Testing Endpoints');

  let passCount = 0;
  let failCount = 0;
  let partialCount = 0;

  for (const endpoint of endpoints) {
    const result = await testEndpoint(endpoint);

    if (result.status === 'PASS') passCount++;
    else if (result.status === 'FAIL') failCount++;
    else partialCount++;

    let details = result.details;
    if (result.data) {
      const counts = Object.entries(result.data)
        .filter(([key]) => key !== 'presentFields' && key !== 'missingFields')
        .map(([key, count]) => `${key}: ${count}`)
        .join(', ');
      details += counts ? ` (${counts})` : '';
    }

    printTestResult(endpoint.name, result.status, details);

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Print summary
  printHeader('Test Summary');
  log(`  Total:  ${endpoints.length}`, 'bright');
  log(`  Passed: ${passCount}`, 'green');
  if (partialCount > 0) {
    log(`  Partial: ${partialCount}`, 'yellow');
  }
  log(`  Failed: ${failCount}`, failCount > 0 ? 'red' : 'green');

  // Exit with appropriate code
  process.exit(failCount > 0 ? 1 : 0);
}

// Run the tests
main().catch(error => {
  log(`\nUnexpected error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
