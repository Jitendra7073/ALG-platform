/**
 * Quick test for Vercel local development setup
 */

// Set Vercel environment to prevent auto-start
process.env.VERCEL = "true";

const express = require("express");
const cors = require("cors");
const path = require("path");

console.log("🧪 Testing Vercel local setup...\n");

// Test 1: Check if we can import the server
try {
  console.log("✅ Testing server import...");
  const serverPath = path.join(__dirname, "../../../src/api/server.js");
  const { apiServer } = require(serverPath);
  console.log("✅ Server imported successfully");

  // Test 2: Check if apiServer is defined
  console.log("\n✅ Checking apiServer export...");
  if (!apiServer) {
    throw new Error("apiServer is undefined");
  }
  console.log("✅ apiServer is properly exported");

  // Test 3: Check if it's an Express app
  console.log("\n✅ Checking Express app structure...");
  if (typeof apiServer.use !== 'function') {
    throw new Error("apiServer.use is not a function");
  }
  console.log("✅ apiServer has Express app methods");

  // Test 4: Try mounting to test app
  console.log("\n✅ Testing app mounting...");
  const testApp = express();
  testApp.use(cors());
  testApp.use(express.json());
  testApp.use("/", apiServer);
  console.log("✅ Successfully mounted apiServer");

  console.log("\n✅ All basic tests passed!");
  console.log("\n📝 Next steps:");
  console.log("   1. Run: vercel dev");
  console.log("   2. Visit: http://localhost:3000");
  console.log("   3. Check browser console for any errors");

} catch (error) {
  console.error("❌ Test failed:", error.message);
  console.error("\n🔧 Common fixes:");
  console.error("   - Ensure all dependencies are installed: npm install");
  console.error("   - Check Express version: npm list express");
  console.error("   - Verify server.js exports apiServer");
  process.exit(1);
}
