const API_BASE = 'http://localhost:3000';

let yesPriceChart = null;
let noPriceChart = null;
let twapChart = null;
let portfolioChart = null;
let priceHistory = {};
let updateInterval = null;

// Initialize charts
function initCharts() {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        display: true,
        position: 'top',
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        ticks: {
          callback: function (value) {
            return value.toFixed(4);
          }
        }
      }
    }
  };

  // YES Token Prices Chart
  const yesCtx = document.getElementById('yesPriceChart').getContext('2d');
  yesPriceChart = new Chart(yesCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: []
    },
    options: chartOptions
  });

  // NO Token Prices Chart
  const noCtx = document.getElementById('noPriceChart').getContext('2d');
  noPriceChart = new Chart(noCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: []
    },
    options: chartOptions
  });

  // TWAP Comparison Chart
  const twapCtx = document.getElementById('twapChart').getContext('2d');
  twapChart = new Chart(twapCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'YES TWAP',
          data: [],
          backgroundColor: 'rgba(16, 185, 129, 0.6)',
          borderColor: 'rgba(16, 185, 129, 1)',
          borderWidth: 1
        },
        {
          label: 'NO TWAP',
          data: [],
          backgroundColor: 'rgba(239, 68, 68, 0.6)',
          borderColor: 'rgba(239, 68, 68, 1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      ...chartOptions,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });

  // Portfolio Values Chart
  const portfolioCtx = document.getElementById('portfolioChart').getContext('2d');
  portfolioChart = new Chart(portfolioCtx, {
    type: 'doughnut',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [
          'rgba(102, 126, 234, 0.8)',
          'rgba(16, 185, 129, 0.8)',
          'rgba(239, 68, 68, 0.8)',
          'rgba(251, 191, 36, 0.8)',
        ],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'right'
        }
      }
    }
  });
}

// Fetch market data
async function fetchMarket() {
  try {
    const response = await fetch(`${API_BASE}/api/market`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching market:', error);
    return null;
  }
}

// Fetch agents data
async function fetchAgents() {
  try {
    const response = await fetch(`${API_BASE}/api/agents`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching agents:', error);
    return null;
  }
}

// Fetch graduated proposals
async function fetchGraduated() {
  try {
    const response = await fetch(`${API_BASE}/api/graduated`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching graduated proposals:', error);
    return [];
  }
}

// Update stats bar
function updateStats(market, agents) {
  document.getElementById('roundNumber').textContent = market.roundNumber || 0;

  // Calculate and display time remaining
  if (market.roundEndTime) {
    const now = Date.now();
    const timeRemaining = Math.max(0, market.roundEndTime - now);
    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    const timerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    document.getElementById('roundEndTimer').textContent = timerText;

    // Update timer color if less than 1 minute remaining
    const timerElement = document.getElementById('roundEndTimer');
    if (timeRemaining < 60000) {
      timerElement.style.color = '#ef4444';
      timerElement.style.fontWeight = 'bold';
    } else if (timeRemaining < 300000) { // Less than 5 minutes
      timerElement.style.color = '#f59e0b';
    } else {
      timerElement.style.color = '';
      timerElement.style.fontWeight = '';
    }
  } else {
    document.getElementById('roundEndTimer').textContent = '--:--';
  }

  document.getElementById('strategyCount').textContent = market.strategies?.length || 0;
  document.getElementById('agentCount').textContent = agents?.length || 0;

  // Check for winner and show banner
  const winningStrategy = market.strategies?.find(s => s.resolved && s.winner === 'yes');
  const winnerBanner = document.getElementById('winnerBanner');
  const winnerDetails = document.getElementById('winnerDetails');

  if (winningStrategy) {
    winnerBanner.style.display = 'block';
    winnerDetails.innerHTML = `
      <div style="font-size: 1.5em; margin: 10px 0;">
        <strong>${winningStrategy.name}</strong>
      </div>
      <div style="margin: 10px 0;">
        ${winningStrategy.description}
      </div>
      <div style="margin: 10px 0; color: #10b981;">
        YES TWAP: ${winningStrategy.yesToken.twap.toFixed(4)}
      </div>
    `;
  } else {
    winnerBanner.style.display = 'none';
  }
}

// Test an RWA strategy on the client side
window.testRwaStrategyOnClient = async function (strategyId) {
  const resultDiv = document.getElementById(`test-results-${strategyId}`);
  resultDiv.innerHTML = '<div class="loading">Fetching live data...</div>';
  resultDiv.classList.add('visible');

  try {
    const market = await fetchMarket();
    const strategy = market.strategies.find(s => s.id === strategyId);
    if (!strategy) throw new Error('Strategy not found');

    const results = [];
    let overallSuccess = true;

    for (const source of strategy.dataSources) {
      try {
        const response = await fetch(source.endpoint);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();

        const currentValue = data.Price || data.exchange_rate || data.yearly_rate_pct || 0;
        const target = typeof source.targetValue === 'string' ? parseFloat(source.targetValue) : source.targetValue;

        let pass = false;
        switch (source.operator) {
          case '>': pass = currentValue > target; break;
          case '<': pass = currentValue < target; break;
          case '==': pass = currentValue == target; break;
          case '>=': pass = currentValue >= target; break;
          case '<=': pass = currentValue <= target; break;
        }

        if (!pass) overallSuccess = false;

        results.push(`
          <div class="test-item">
            <span>${source.id}: ${currentValue.toFixed(2)} ${source.operator} ${target}</span>
            <span class="${pass ? 'pass' : 'fail'}">${pass ? 'PASSED' : 'FAILED'}</span>
          </div>
        `);
      } catch (err) {
        results.push(`<div class="test-item"><span class="fail">${source.id}: Error (${err.message})</span></div>`);
        overallSuccess = false;
      }
    }

    resultDiv.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 8px; color: ${overallSuccess ? '#10b981' : '#ef4444'}">
        OVERALL: ${overallSuccess ? 'SUCCESS' : 'FAILURE'}
      </div>
      ${results.join('')}
    `;
  } catch (error) {
    resultDiv.innerHTML = `<div class="fail">Test failed: ${error.message}</div>`;
  }
};

// Data sources cache
let dataSourcesMap = {};

// Fetch data sources
async function fetchDataSources() {
  try {
    const response = await fetch(`${API_BASE}/api/data-sources`);
    const data = await response.json();
    data.forEach(ds => {
      dataSourcesMap[ds.id] = ds;
    });
    console.log('Data sources loaded:', Object.keys(dataSourcesMap).length);
  } catch (error) {
    console.error('Failed to fetch data sources:', error);
  }
}

// Render strategies
function renderStrategies(strategies) {
  const container = document.getElementById('strategiesContainer');
  container.innerHTML = '';

  strategies.forEach(strategy => {
    // Calculate prices using new model: YES + NO ≈ 1.0
    const yesTokenReserve = strategy.yesToken.tokenReserve || 2000;
    const noTokenReserve = strategy.noToken.tokenReserve || 2000;
    const totalReserve = yesTokenReserve + noTokenReserve;
    const yesPrice = totalReserve > 0 ? (noTokenReserve / totalReserve).toFixed(4) : '0.5000';
    const noPrice = totalReserve > 0 ? (yesTokenReserve / totalReserve).toFixed(4) : '0.5000';
    const yesTWAP = strategy.yesToken.twap.toFixed(4);
    const noTWAP = strategy.noToken.twap.toFixed(4);

    const deadline = strategy.resolutionDeadline ? new Date(strategy.resolutionDeadline).toLocaleDateString() : 'N/A';

    const card = document.createElement('div');
    card.className = `strategy-card ${strategy.resolved ? 'resolved' : ''} ${strategy.winner === 'yes' ? 'winner' : strategy.winner === 'no' ? 'loser' : ''}`;

    let statusClass = 'active';
    let statusText = 'ACTIVE';
    if (strategy.resolved) {
      statusClass = strategy.winner === 'yes' ? 'winner' : 'loser';
      statusText = strategy.winner === 'yes' ? 'WINNER' : 'LOSER';
    }

    // Resolve data source details
    // Resolve data source details
    let dataSourceHtml = '';
    if (strategy.usedDataSources && strategy.usedDataSources.length > 0) {
      dataSourceHtml = `
        <div class="strategy-data-sources">
          <div class="data-sources-label">Verified Sources:</div>
          <div class="data-sources-list">
      `;

      strategy.usedDataSources.forEach(source => {
        const ds = dataSourcesMap[source.id];
        if (ds) {
          dataSourceHtml += `
            <div class="data-source-tag">
              <span class="data-source-id">[${ds.ticker}] ${ds.name}</span>
              <div style="font-size: 10px; color: #6b7280; font-style: italic; margin-bottom: 2px;">${ds.type}</div>
              <span class="data-source-endpoint" title="${ds.endpoint}">${ds.endpoint}</span>
              <div style="font-size: 10px; color: #4b5563; margin-top: 4px;">
                Initial: <strong>${source.currentValue}</strong> ${source.operator || 'vs'} Target: <strong>${source.targetValue}</strong>
              </div>
            </div>
          `;
        } else {
          dataSourceHtml += `<div class="data-source-tag">Unknown Source ID: ${source.id}</div>`;
        }
      });

      dataSourceHtml += `
          </div>
        </div>
      `;
    } else if (strategy.dataSourceId && dataSourcesMap[strategy.dataSourceId]) {
      const ds = dataSourcesMap[strategy.dataSourceId];
      dataSourceHtml = `
        <div class="strategy-data-sources">
          <div class="data-sources-label">Verified Source (ID: ${strategy.dataSourceId}):</div>
          <div class="data-sources-list">
            <div class="data-source-tag">
              <span class="data-source-id">[${ds.ticker}] ${ds.name}</span>
              <div style="font-size: 10px; color: #6b7280; font-style: italic; margin-bottom: 2px;">${ds.type}</div>
              <span class="data-source-endpoint" title="${ds.endpoint}">${ds.endpoint}</span>
              <div style="font-size: 10px; color: #4b5563; margin-top: 4px;">
                Initial: <strong>${strategy.currentValue}</strong> → Target: <strong>${strategy.targetValue}</strong>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      dataSourceHtml = `<div class="strategy-data-sources" style="color: #999; font-style: italic;">Source ID: ${strategy.dataSourceId || 'Unknown'}</div>`;
    }

    // Logic section
    const logicHtml = `
      <div class="strategy-logic">
        <div class="logic-label">Evaluation Logic</div>
        <div class="logic-value">${strategy.evaluationLogic || 'N/A'}</div>
        <div style="font-size: 10px; color: #9d174d; margin-top: 4px; opacity: 0.7;">
          Math: ${strategy.mathematicalLogic || 'N/A'}
        </div>
      </div>
    `;

    card.innerHTML = `
      <div class="strategy-header">
        <div class="strategy-name">${strategy.name}</div>
        <span class="strategy-status ${statusClass}">${statusText}</span>
      </div>
      <div class="strategy-description">${strategy.description}</div>
      <div class="deadline-tag">📅 Resolution: ${deadline}</div>
      
      ${logicHtml}
      ${dataSourceHtml}


      <div class="strategy-prices">
        <div class="price-box">
          <div class="price-label">YES Token</div>
          <div class="price-value">$${yesPrice}</div>
          <div class="twap-value">TWAP: ${yesTWAP}</div>
        </div>
        <div class="price-box">
          <div class="price-label">NO Token</div>
          <div class="price-value">$${noPrice}</div>
          <div class="twap-value">TWAP: ${noTWAP}</div>
        </div>
      </div>

      <div class="test-section">
        <button class="btn-test" onclick="testRwaStrategyOnClient('${strategy.id}')">TEST STRATEGY LOGIC</button>
        <div id="test-results-${strategy.id}" class="test-results"></div>
      </div>

      <div style="margin-top: 10px; font-size: 12px; color: #6b7280; text-align: center;">
        Sum: ${(parseFloat(yesPrice) + parseFloat(noPrice)).toFixed(4)}
      </div>
    `;

    container.appendChild(card);

    // Store price history
    if (!priceHistory[strategy.id]) {
      priceHistory[strategy.id] = { yes: [], no: [], yesTWAP: [], noTWAP: [] };
    }
    priceHistory[strategy.id].yes.push(parseFloat(yesPrice));
    priceHistory[strategy.id].no.push(parseFloat(noPrice));
    priceHistory[strategy.id].yesTWAP.push(parseFloat(yesTWAP));
    priceHistory[strategy.id].noTWAP.push(parseFloat(noTWAP));

    if (priceHistory[strategy.id].yes.length > 50) {
      priceHistory[strategy.id].yes.shift();
      priceHistory[strategy.id].no.shift();
      priceHistory[strategy.id].yesTWAP.shift();
      priceHistory[strategy.id].noTWAP.shift();
    }
  });
}

// Render agents
function renderAgents(agents) {
  const container = document.getElementById('agentsContainer');
  container.innerHTML = '';

  agents.forEach(agent => {
    const card = document.createElement('div');
    card.className = 'agent-card';

    card.innerHTML = `
      <div class="agent-header">
        <div class="agent-name">${agent.personality.name}</div>
        <span class="agent-strategy">${agent.strategy}</span>
      </div>
      <div class="agent-stats">
        <div class="agent-stat">
          <div class="agent-stat-label">vUSD Balance</div>
          <div class="agent-stat-value">$${agent.vUSD.toFixed(2)}</div>
        </div>
        <div class="agent-stat">
          <div class="agent-stat-label">Total Value</div>
          <div class="agent-stat-value">$${agent.totalValue.toFixed(2)}</div>
        </div>
        <div class="agent-stat">
          <div class="agent-stat-label">Trades</div>
          <div class="agent-stat-value">${agent.tradeCount}</div>
        </div>
        <div class="agent-stat">
          <div class="agent-stat-label">Risk</div>
          <div class="agent-stat-value">${agent.personality.riskTolerance}</div>
        </div>
      </div>
      <div class="agent-traits">
        ${agent.personality.traits.map(trait => `<span class="trait">${trait}</span>`).join('')}
      </div>
      <div class="agent-wallet">
        <span class="agent-wallet-label">Ethereum Wallet</span>
        ${agent.wallet?.address || 'N/A'}
      </div>
      <div style="margin-top: 10px; font-size: 12px; color: #6b7280; font-style: italic;">
        ${agent.personality.memo}
      </div>
    `;

    container.appendChild(card);
  });
}

// Update charts
function updateCharts(market, agents) {
  // YES Price Chart
  const yesDatasets = market.strategies.map((strategy, idx) => ({
    label: strategy.name,
    data: priceHistory[strategy.id]?.yes || [],
    borderColor: `hsl(${idx * 60}, 70%, 50%)`,
    backgroundColor: `hsla(${idx * 60}, 70%, 50%, 0.1)`,
    tension: 0.4,
    fill: false
  }));

  yesPriceChart.data.datasets = yesDatasets;
  yesPriceChart.data.labels = Array.from({ length: yesDatasets[0]?.data.length || 0 }, (_, i) => i + 1);
  yesPriceChart.update();

  // NO Price Chart
  const noDatasets = market.strategies.map((strategy, idx) => ({
    label: strategy.name,
    data: priceHistory[strategy.id]?.no || [],
    borderColor: `hsl(${idx * 60}, 70%, 50%)`,
    backgroundColor: `hsla(${idx * 60}, 70%, 50%, 0.1)`,
    tension: 0.4,
    fill: false
  }));

  noPriceChart.data.datasets = noDatasets;
  noPriceChart.data.labels = Array.from({ length: noDatasets[0]?.data.length || 0 }, (_, i) => i + 1);
  noPriceChart.update();

  // TWAP Chart
  twapChart.data.labels = market.strategies.map(s => s.name);
  twapChart.data.datasets[0].data = market.strategies.map(s => s.yesToken.twap);
  twapChart.data.datasets[1].data = market.strategies.map(s => s.noToken.twap);
  twapChart.update();

  // Portfolio Chart
  portfolioChart.data.labels = agents.map(a => a.personality.name);
  portfolioChart.data.datasets[0].data = agents.map(a => a.totalValue);
  portfolioChart.update();
}

// Render recent trades (from agent data)
function renderTrades(agents) {
  const container = document.getElementById('tradesContainer');
  container.innerHTML = '';

  // Collect all trades and hold actions from all agents
  const allTrades = [];
  agents.forEach(agent => {
    // Add executed trades (buy/sell)
    if (agent.trades && agent.trades.length > 0) {
      agent.trades.slice(-10).forEach(trade => {
        allTrades.push({ ...trade, agentName: agent.personality.name });
      });
    }

    // Add hold actions from roundMemory
    if (agent.roundMemory && agent.roundMemory.length > 0) {
      agent.roundMemory
        .filter(m => m.action === 'hold')
        .slice(-10)
        .forEach(memory => {
          allTrades.push({
            type: 'hold',
            strategyId: memory.strategyId,
            tokenType: memory.tokenType,
            price: memory.price,
            quantity: memory.quantity,
            timestamp: memory.timestamp,
            reasoning: memory.reasoning,
            agentName: agent.personality.name,
          });
        });
    }
  });

  // Sort by timestamp (newest first)
  allTrades.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (allTrades.length === 0) {
    container.innerHTML = '<div class="loading">No trades yet. Start trading to see activity!</div>';
    return;
  }

  allTrades.slice(0, 30).forEach(trade => {
    const item = document.createElement('div');
    item.className = 'trade-item';

    const actionClass = trade.type === 'buy' ? 'buy' : trade.type === 'sell' ? 'sell' : 'hold';
    const actionText = trade.type?.toUpperCase() || 'HOLD';

    // Format timestamp
    const timestamp = trade.timestamp ? new Date(trade.timestamp).toLocaleTimeString() : '';

    // Get strategy name if available
    const strategyName = trade.strategyId ? ` (${trade.strategyId.substring(0, 20)}...)` : '';

    item.innerHTML = `
      <div class="trade-info">
        <div class="trade-agent">${trade.agentName || 'Unknown'}</div>
        <div class="trade-details">
          ${actionText} ${trade.quantity || 0} ${(trade.tokenType || 'yes').toUpperCase()} tokens${strategyName}
          ${timestamp ? ` • ${timestamp}` : ''}
        </div>
        ${trade.reasoning ? `<div class="trade-reasoning">Reasoning: ${trade.reasoning}</div>` : ''}
        ${trade.txHash ? `
          <div class="trade-hash" style="font-size: 10px; color: #9ca3af; margin-top: 4px;">
            <span title="${trade.txHash}">⛓️ ${trade.txHash.substring(0, 10)}...${trade.txHash.substring(trade.txHash.length - 8)}</span>
          </div>
        ` : ''}
      </div>
      <div style="display: flex; align-items: center;">
        <span class="trade-action ${actionClass}">${actionText}</span>
        ${trade.type !== 'hold' ? `<span class="trade-price">$${(trade.price || 0).toFixed(4)}</span>` : ''}
      </div>
    `;

    container.appendChild(item);
  });
}

// Fetch system logs
async function fetchLogs() {
  try {
    const response = await fetch(`${API_BASE}/api/logs`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching logs:', error);
    return null;
  }
}

// Render system logs
function renderLogs(logs) {
  const container = document.getElementById('logsContainer');
  if (!container || !logs) return;

  const logsHtml = logs.map(log => `
    <div class="log-item">
      <span class="log-timestamp">[${new Date(log.timestamp).toLocaleTimeString()}]</span>
      <span class="log-source">[${log.source}]</span>
      <span class="log-level log-level-${log.level}">${log.level.toUpperCase()}</span>
      <span class="log-message">${log.message}</span>
    </div>
  `).join('');

  container.innerHTML = logsHtml;

  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// Render graduated proposals
function renderGraduated(proposals) {
  const container = document.getElementById('graduatedContainer');
  if (!proposals || proposals.length === 0) {
    container.innerHTML = '<div class="loading">No proposals have graduated yet.</div>';
    return;
  }

  container.innerHTML = '';
  proposals.forEach(p => {
    const item = document.createElement('div');
    item.className = 'graduated-item';
    item.innerHTML = `
      <div class="graduated-info">
        <div class="graduated-name">${p.name}</div>
        <div class="graduated-description">${p.description}</div>
        <div class="graduated-meta">
          Winner: <span class="winner-tag">YES</span> • TWAP: ${p.yesToken.twap.toFixed(4)} • Resolved at: ${new Date(p.timestamp).toLocaleString()}
        </div>
      </div>
      <div class="graduated-badge">GRADUATED</div>
    `;
    container.appendChild(item);
  });
}

// Refresh all data
async function refreshData() {
  const market = await fetchMarket();
  const agents = await fetchAgents();
  const graduated = await fetchGraduated();

  if (market) {
    updateStats(market, agents);
    renderStrategies(market.strategies);
    updateCharts(market, agents || []);
  }

  if (agents) {
    renderAgents(agents);
    renderTrades(agents);
  }

  if (graduated) {
    renderGraduated(graduated);
  }

  const logs = await fetchLogs();
  if (logs) {
    renderLogs(logs);
  }
}

// Event listeners
document.getElementById('startBtn').addEventListener('click', async () => {
  try {
    const response = await fetch(`${API_BASE}/api/trade/start`, { method: 'POST' });
    const data = await response.json();
    if (response.ok) {
      alert('Trading round started! Timer is now active.');
      await refreshData();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    alert('Error starting trading: ' + error.message);
  }
});

document.getElementById('initProposalsBtn').addEventListener('click', async () => {
  const btn = document.getElementById('initProposalsBtn');
  const originalText = btn.textContent;
  try {
    btn.textContent = 'Generating...';
    btn.disabled = true;
    const response = await fetch(`${API_BASE}/api/init/proposals`, { method: 'POST' });
    const data = await response.json();
    if (response.ok) {
      alert(`Success: ${data.message} (${data.count} proposals)`);
      await refreshData();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    alert('Error generating proposals: ' + error.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

document.getElementById('initAgentsBtn').addEventListener('click', async () => {
  const btn = document.getElementById('initAgentsBtn');
  const originalText = btn.textContent;
  try {
    btn.textContent = 'Generating...';
    btn.disabled = true;
    const response = await fetch(`${API_BASE}/api/init/agents`, { method: 'POST' });
    const data = await response.json();
    if (response.ok) {
      alert(`Success: ${data.message} (${data.count} agents)`);
      await refreshData();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    alert('Error generating agents: ' + error.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

document.getElementById('refreshBtn').addEventListener('click', refreshData);

// Initialize
initCharts();
fetchDataSources();
refreshData();

// Auto-refresh every 2 seconds (for timer updates)
setInterval(refreshData, 2000);

