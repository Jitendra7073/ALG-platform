#!/usr/bin/env node

/**
 * Webhook Testing Script for Email Sending System
 * Tests all webhook endpoints with example payloads
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

interface TestPayload {
  event: string;
  data: any;
}

interface TestResult {
  success: boolean;
  statusCode: number;
  body: any;
  latency: number;
}

/**
 * Test a webhook endpoint
 */
async function testWebhook(
  endpoint: string,
  payload: TestPayload
): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const latency = Date.now() - startTime;
    const body = await response.json();

    return {
      success: response.ok,
      statusCode: response.status,
      body,
      latency,
    };
  } catch (error: any) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      statusCode: 0,
      body: { error: error.message },
      latency,
    };
  }
}

/**
 * Test health check endpoint
 */
async function testHealth(endpoint: string): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'GET',
    });

    const latency = Date.now() - startTime;
    const body = await response.json();

    return {
      success: response.ok,
      statusCode: response.status,
      body,
      latency,
    };
  } catch (error: any) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      statusCode: 0,
      body: { error: error.message },
      latency,
    };
  }
}

/**
 * Load test payload from file
 */
function loadPayload(filename: string): TestPayload {
  try {
    const content = readFileSync(join(process.cwd(), filename), 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    throw new Error(`Failed to load payload from ${filename}: ${error.message}`);
  }
}

/**
 * Format test result for display
 */
function formatResult(
  testName: string,
  result: TestResult,
  showBody: boolean = false
): void {
  const status = result.success ? '✅' : '❌';
  const statusText = result.success
    ? `Success (${result.statusCode})`
    : `Failed (${result.statusCode || 'Error'})`;

  console.log(`\n${status} ${testName}`);
  console.log(`   Status: ${statusText}`);
  console.log(`   Latency: ${result.latency}ms`);

  if (showBody && result.body) {
    console.log(`   Response:`, JSON.stringify(result.body, null, 2));
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('🧪 Testing Email Webhook System');
  console.log('================================');
  console.log(`Base URL: ${BASE_URL}\n`);

  // Health checks
  console.log('🏥 Health Checks');
  console.log('================');

  const healthEndpoints = [
    { path: '/api/webhooks/email-sent', name: 'Email Sent Webhook' },
    { path: '/api/webhooks/email-failed', name: 'Email Failed Webhook' },
    { path: '/api/webhooks/email-opened', name: 'Email Opened Webhook' },
    { path: '/api/webhooks/email-clicked', name: 'Email Clicked Webhook' },
  ];

  for (const endpoint of healthEndpoints) {
    const result = await testHealth(endpoint.path);
    formatResult(endpoint.name, result, true);
  }

  // Webhook event tests
  console.log('\n\n📨 Webhook Event Tests');
  console.log('======================');

  const webhookTests = [
    {
      endpoint: '/api/webhooks/email-sent',
      payload: 'test-payloads/email-sent.json',
      name: 'Email Sent Event',
    },
    {
      endpoint: '/api/webhooks/email-failed',
      payload: 'test-payloads/email-failed.json',
      name: 'Email Failed Event',
    },
    {
      endpoint: '/api/webhooks/email-opened',
      payload: 'test-payloads/email-opened.json',
      name: 'Email Opened Event',
    },
    {
      endpoint: '/api/webhooks/email-clicked',
      payload: 'test-payloads/email-clicked.json',
      name: 'Email Clicked Event',
    },
  ];

  let successCount = 0;
  let failCount = 0;

  for (const test of webhookTests) {
    try {
      const payload = loadPayload(test.payload);
      const result = await testWebhook(test.endpoint, payload);
      formatResult(test.name, result, true);

      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (error: any) {
      console.error(`\n❌ ${test.name}`);
      console.error(`   Error: ${error.message}`);
      failCount++;
    }
  }

  // Summary
  console.log('\n\n✨ Testing Complete!');
  console.log('====================');
  console.log(`Total: ${successCount + failCount}`);
  console.log(`✅ Passed: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);

  if (failCount > 0) {
    console.log('\n💡 Troubleshooting Tips:');
    console.log('  - Make sure your Next.js server is running');
    console.log('  - Check database migration has been run');
    console.log('  - Verify environment variables are set');
    console.log('  - Review server logs for detailed error messages');
    console.log('  - Ensure database tables exist');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

// Run tests
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
