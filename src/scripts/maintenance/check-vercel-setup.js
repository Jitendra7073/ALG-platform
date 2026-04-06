/**
 * Vercel Deployment Setup Checker
 *
 * This script checks if your project is properly configured for Vercel deployment.
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking Vercel deployment setup...\n');

const checks = [];
let allPassed = true;

// Check 1: Required files exist
console.log('📁 Checking required files...');
const requiredFiles = [
  'api/index.js',
  'vercel.json',
  'package.json',
  '.vercelignore'
];

requiredFiles.forEach(file => {
  const exists = fs.existsSync(path.join(process.cwd(), file));
  checks.push({
    name: `File: ${file}`,
    passed: exists,
    message: exists ? '✅ Found' : '❌ Missing'
  });
  if (!exists) allPassed = false;
});

// Check 2: Environment variables template
console.log('\n🔐 Checking environment setup...');
const envExample = fs.existsSync('.env.example');
checks.push({
  name: 'Environment template',
  passed: envExample,
  message: envExample ? '✅ .env.example found' : '⚠️  .env.example not found (recommended)'
});

// Check 3: Server exports
console.log('\n🔧 Checking server configuration...');
try {
  const serverContent = fs.readFileSync('src/api/server.js', 'utf8');
  const exportsApiServer = serverContent.includes('module.exports = { apiServer }');
  const vercelCheck = serverContent.includes('process.env.VERCEL');

  checks.push({
    name: 'Server exports apiServer',
    passed: exportsApiServer,
    message: exportsApiServer ? '✅ apiServer exported' : '❌ apiServer not exported'
  });

  checks.push({
    name: 'Vercel environment detection',
    passed: vercelCheck,
    message: vercelCheck ? '✅ Vercel detection found' : '❌ No Vercel detection'
  });

  if (!exportsApiServer || !vercelCheck) allPassed = false;
} catch (error) {
  checks.push({
    name: 'Server configuration',
    passed: false,
    message: `❌ Error reading server.js: ${error.message}`
  });
  allPassed = false;
}

// Check 4: API entry point
console.log('\n🚀 Checking API entry point...');
try {
  const apiContent = fs.readFileSync('api/index.js', 'utf8');
  const requiresServer = apiContent.includes("require('../src/api/server.js')");
  const exportsApp = apiContent.includes('module.exports = app');

  checks.push({
    name: 'API entry point imports server',
    passed: requiresServer,
    message: requiresServer ? '✅ Imports main server' : '❌ Does not import server'
  });

  checks.push({
    name: 'API entry point exports app',
    passed: exportsApp,
    message: exportsApp ? '✅ Exports Express app' : '❌ Does not export app'
  });

  if (!requiresServer || !exportsApp) allPassed = false;
} catch (error) {
  checks.push({
    name: 'API entry point',
    passed: false,
    message: `❌ Error reading api/index.js: ${error.message}`
  });
  allPassed = false;
}

// Check 5: Vercel configuration
console.log('\n⚙️  Checking Vercel configuration...');
try {
  const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const hasBuilds = vercelConfig.builds && vercelConfig.builds.length > 0;
  const hasRoutes = vercelConfig.routes && vercelConfig.routes.length > 0;

  checks.push({
    name: 'Vercel builds configuration',
    passed: hasBuilds,
    message: hasBuilds ? '✅ Builds configured' : '⚠️  No builds found'
  });

  checks.push({
    name: 'Vercel routes configuration',
    passed: hasRoutes,
    message: hasRoutes ? '✅ Routes configured' : '⚠️  No routes found'
  });
} catch (error) {
  checks.push({
    name: 'Vercel configuration',
    passed: false,
    message: `❌ Error reading vercel.json: ${error.message}`
  });
  allPassed = false;
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('📊 SUMMARY');
console.log('='.repeat(50));

checks.forEach(check => {
  console.log(`${check.message} - ${check.name}`);
});

console.log('\n' + '='.repeat(50));
if (allPassed) {
  console.log('✅ All critical checks passed! Ready for Vercel deployment.');
  console.log('\n📝 Next steps:');
  console.log('   1. Set environment variables in Vercel dashboard');
  console.log('   2. Run: vercel login');
  console.log('   3. Run: vercel --prod');
} else {
  console.log('❌ Some checks failed. Please fix the issues above before deploying.');
  console.log('\n💡 Common fixes:');
  console.log('   - Ensure api/index.js exists and exports the app');
  console.log('   - Verify src/api/server.js exports { apiServer }');
  console.log('   - Check that vercel.json is properly configured');
}
console.log('='.repeat(50));

process.exit(allPassed ? 0 : 1);