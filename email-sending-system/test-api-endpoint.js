/**
 * Test sequences API endpoint
 */

async function testSequencesAPI() {
  const baseUrl = 'http://localhost:3000';

  try {
    console.log('🧪 Testing Sequences API Endpoints...\n');

    // Test 1: GET all sequences
    console.log('📋 Test 1: GET /api/sequences');
    const getResponse = await fetch(`${baseUrl}/api/sequences`);
    const getData = await getResponse.json();

    console.log(`Status: ${getResponse.status}`);
    if (getData.success) {
      console.log(`✅ Found ${getData.data.length} sequences`);
      if (getData.data.length > 0) {
        console.log(`   First sequence: ${getData.data[0].name}`);
        console.log(`   Items count: ${getData.data[0].items?.length || 0}`);
      }
    } else {
      console.log(`❌ Error: ${getData.error}`);
    }

    if (!getData.success || getData.data.length === 0) {
      console.log('\n❌ Cannot proceed with further tests - no sequences available');
      return;
    }

    const testSequence = getData.data[0];

    // Test 2: PUT update sequence
    console.log(`\n📝 Test 2: PUT /api/sequences (Update "${testSequence.name}")`);

    const updateData = {
      id: testSequence.id,
      name: `TEST EDIT - ${testSequence.name}`,
      description: 'Test edit description',
      is_active: testSequence.is_active
    };

    const putResponse = await fetch(`${baseUrl}/api/sequences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });

    const putData = await putResponse.json();

    console.log(`Status: ${putResponse.status}`);
    if (putData.success) {
      console.log('✅ Sequence updated successfully:');
      console.log(`   Name: ${putData.data.name}`);
      console.log(`   Description: ${putData.data.description}`);
      console.log(`   Updated At: ${putData.data.updated_at}`);
    } else {
      console.log(`❌ Error: ${putData.error}`);
    }

    // Test 3: Verify update
    console.log(`\n🔍 Test 3: Verify update was persisted`);

    const verifyResponse = await fetch(`${baseUrl}/api/sequences`);
    const verifyData = await verifyResponse.json();

    if (verifyData.success) {
      const updatedSequence = verifyData.data.find((s) => s.id === testSequence.id);
      if (updatedSequence && updatedSequence.name.startsWith('TEST EDIT')) {
        console.log('✅ Update verified in database');
        console.log(`   Name: ${updatedSequence.name}`);

        // Revert the test change
        console.log(`\n🔄 Reverting test changes...`);
        await fetch(`${baseUrl}/api/sequences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: testSequence.id,
            name: testSequence.name,
            description: testSequence.description,
            is_active: testSequence.is_active
          })
        });
        console.log('✅ Test changes reverted');
      } else {
        console.log('❌ Update not found in database');
      }
    }

    console.log('\n✅ API endpoint tests completed!');

  } catch (error) {
    console.error('❌ API Test error:', error.message);
    console.log('\n💡 Make sure the Next.js dev server is running on http://localhost:3001');
  }
}

testSequencesAPI();
