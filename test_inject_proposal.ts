// Test script for /api/proposal/inject endpoint

const testProposal = {
  name: "iShares Bitcoin Trust breaks $60",
  description: "iShares Bitcoin Trust (IBIT) price will exceed $60 by March 2026",
  evaluationLogic: "IBIT > 60",
  mathematicalLogic: "price > 60",
  usedDataSources: [
    {
      id: 12251,  // iShares Bitcoin Trust (IBIT) - actual ID from dataSources.ts
      currentValue: 51.17,  // Current IBIT price from data source
      targetValue: 60,
      operator: ">"
    }
  ],
  resolutionDeadline: new Date('2026-03-31').getTime(),
  initialLiquidity: 2000
};

async function testInjectProposal() {
  try {
    console.log('Testing /api/proposal/inject endpoint...\n');
    
    // First check if market is initialized
    console.log('1. Checking market state...');
    const marketResponse = await fetch('http://localhost:3000/api/market');
    const marketData = await marketResponse.json();
    
    if (marketData.strategies.length === 0) {
      console.log('⚠️  Market not initialized. Call /api/admin/init first!');
      console.log('\nYou can initialize with:');
      console.log('  curl -X POST http://localhost:3000/api/admin/init\n');
      return;
    }
    
    console.log(`✅ Market has ${marketData.strategies.length} AI-generated proposals\n`);
    
    console.log('2. Injecting custom proposal...');
    console.log('Proposal:', JSON.stringify(testProposal, null, 2));
    
    const response = await fetch('http://localhost:3000/api/proposal/inject', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testProposal)
    });

    const result = await response.json();
    
    console.log('\nResponse status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n✅ SUCCESS! Proposal injected successfully!');
      console.log('   ID:', result.proposal.id);
      console.log('   Name:', result.proposal.name);
      console.log('   YES Token:', result.proposal.yesToken);
      console.log('   TX Hash:', result.proposal.txHash);
      
      // Check updated market state
      const updatedMarket = await fetch('http://localhost:3000/api/market');
      const updatedData = await updatedMarket.json();
      console.log(`\n   Total proposals now: ${updatedData.strategies.length}`);
    } else {
      console.log('\n❌ FAILED:', result.error);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testInjectProposal();
