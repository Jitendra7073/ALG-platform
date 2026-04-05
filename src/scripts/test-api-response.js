/**
 * Test API Response Format
 * Verify that the API responses match what the frontend expects
 */

require('dotenv').config();
const http = require('http');

async function testEndpoint(path, name) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 8080,
      path: path,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`\n${name}:`);
          console.log(`  Status: ${res.statusCode}`);
          console.log(`  Has success field: ${json.hasOwnProperty('success')}`);
          console.log(`  Success value: ${json.success}`);
          console.log(`  Has data field: ${json.hasOwnProperty('data')}`);
          if (json.data) {
            if (Array.isArray(json.data)) {
              console.log(`  Data type: Array`);
              console.log(`  Data length: ${json.data.length}`);
              if (json.data.length > 0) {
                console.log(`  First item keys: ${Object.keys(json.data[0]).join(', ')}`);
              }
            } else {
              console.log(`  Data type: ${typeof json.data}`);
              console.log(`  Data keys: ${Object.keys(json.data).join(', ')}`);
            }
          }
          resolve({ success: json.success, hasData: !!json.data });
        } catch (e) {
          console.log(`\n${name}: PARSE ERROR`);
          console.log(`  Response: ${data.substring(0, 200)}`);
          resolve({ success: false, hasData: false });
        }
      });
    });

    req.on('error', (e) => {
      console.log(`\n${name}: CONNECTION ERROR - ${e.message}`);
      resolve({ success: false, hasData: false });
    });

    req.end();
  });
}

async function runTests() {
  console.log('============================================================');
  console.log('  API Response Format Test');
  console.log('============================================================');

  const tests = [
    ['/api/keywords', 'Keywords'],
    ['/api/sites/all', 'Sites (All)'],
    ['/api/stats', 'Statistics'],
    ['/api/contacts/all', 'Contacts'],
  ];

  let passCount = 0;
  for (const [path, name] of tests) {
    const result = await testEndpoint(path, name);
    if (result.success && result.hasData) passCount++;
  }

  console.log('\n============================================================');
  console.log(`  Results: ${passCount}/${tests.length} passed`);
  console.log('============================================================');

  process.exit(passCount === tests.length ? 0 : 1);
}

runTests().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
