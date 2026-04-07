#!/bin/bash

# Webhook Testing Script for Email Sending System
# Tests all webhook endpoints with example payloads

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "🧪 Testing Email Webhook System"
echo "================================"
echo "Base URL: $BASE_URL"
echo ""

# Function to test webhook endpoint
test_webhook() {
  local endpoint="$1"
  local payload_file="$2"
  local description="$3"

  echo "Testing: $description"
  echo "Endpoint: $endpoint"

  if [ ! -f "$payload_file" ]; then
    echo "❌ Payload file not found: $payload_file"
    echo ""
    return 1
  fi

  response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    "$BASE_URL$endpoint" \
    -H "Content-Type: application/json" \
    -d @"$payload_file")

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -eq 200 ]; then
    echo "✅ Success (HTTP $http_code)"
    echo "Response: $body"
  else
    echo "❌ Failed (HTTP $http_code)"
    echo "Response: $body"
  fi

  echo ""
}

# Function to test health check endpoint
test_health() {
  local endpoint="$1"
  local description="$2"

  echo "Testing: $description (Health Check)"
  echo "Endpoint: $endpoint"

  response=$(curl -s -w "\n%{http_code}" \
    -X GET \
    "$BASE_URL$endpoint")

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -eq 200 ]; then
    echo "✅ Online (HTTP $http_code)"
    echo "Response: $body"
  else
    echo "❌ Offline (HTTP $http_code)"
  fi

  echo ""
}

echo "🏥 Health Checks"
echo "================"
test_health "/api/webhooks/email-sent" "Email Sent Webhook"
test_health "/api/webhooks/email-failed" "Email Failed Webhook"
test_health "/api/webhooks/email-opened" "Email Opened Webhook"
test_health "/api/webhooks/email-clicked" "Email Clicked Webhook"

echo "📨 Webhook Event Tests"
echo "======================"
test_webhook \
  "/api/webhooks/email-sent" \
  "test-payloads/email-sent.json" \
  "Email Sent Event"

test_webhook \
  "/api/webhooks/email-failed" \
  "test-payloads/email-failed.json" \
  "Email Failed Event"

test_webhook \
  "/api/webhooks/email-opened" \
  "test-payloads/email-opened.json" \
  "Email Opened Event"

test_webhook \
  "/api/webhooks/email-clicked" \
  "test-payloads/email-clicked.json" \
  "Email Clicked Event"

echo "✨ Testing Complete!"
echo ""
echo "💡 Tips:"
echo "  - Make sure your Next.js server is running"
echo "  - Check database migration has been run"
echo "  - Verify environment variables are set"
echo "  - Review logs for detailed error messages"
