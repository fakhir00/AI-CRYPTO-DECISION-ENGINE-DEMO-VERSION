import './style.css';
import { fetchMarketData, fetchGlobalMarketData, fetchWhaleActivity, fetchSentiment, fetchAIAnalysis, fetchHermesAnalysis, fetchDualAI, calculateAlphaScore } from './api.js';

// --- Navigation & Setup ---
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard Overview', icon: 'grid' },
  { id: 'opportunities', label: 'Top Opportunities', icon: 'trending-up' },
  { id: 'trading', label: 'Advanced Pro Terminal', icon: 'monitor' },
  { id: 'ai-research', label: 'AI Research Analyst', icon: 'cpu' },
  { id: 'whale', label: 'Whale & Smart Money', icon: 'anchor' },
  { id: 'news', label: 'News & Catalysts', icon: 'globe' },
  { id: 'sentiment', label: 'Sentiment & Narratives', icon: 'smile' },
  { id: 'technical', label: 'Technical Signals', icon: 'activity' },
  { id: 'defi', label: 'DeFi Scanner', icon: 'layers' },
  { id: 'command', label: 'AI Command Center', icon: 'terminal' },
  { id: 'alerts', label: 'Alerts & Notifications', icon: 'bell' },
  { id: 'paper-trading', label: 'Paper Trading Lab', icon: 'zap', badge: 'BETA' },
  { id: 'settings', label: 'Settings & Subscription', icon: 'settings' }
];

// --- Mock Data ---
const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', price: 64230.50, change: 2.4, score: 78, bias: 'bullish', confidence: 85, vol: '24.5B' },
  { symbol: 'ETH', name: 'Ethereum', price: 3450.20, change: 1.2, score: 65, bias: 'neutral', confidence: 72, vol: '12.1B' },
  { symbol: 'SOL', name: 'Solana', price: 164.32, change: 5.62, score: 89, bias: 'bullish', confidence: 91, vol: '3.2B' },
  { symbol: 'LINK', name: 'Chainlink', price: 18.54, change: 3.21, score: 85, bias: 'bullish', confidence: 88, vol: '850M' },
  { symbol: 'ARB', name: 'Arbitrum', price: 1.25, change: 7.15, score: 82, bias: 'bullish', confidence: 85, vol: '420M' },
  { symbol: 'INJ', name: 'Injective', price: 27.50, change: 4.20, score: 78, bias: 'bullish', confidence: 80, vol: '310M' },
  { symbol: 'RNDR', name: 'Render', price: 7.31, change: 8.25, score: 75, bias: 'bullish', confidence: 75, vol: '280M' },
  { symbol: 'OP', name: 'Optimism', price: 2.55, change: -1.40, score: 74, bias: 'neutral', confidence: 70, vol: '190M' },
  { symbol: 'SUI', name: 'Sui', price: 1.68, change: 6.15, score: 71, bias: 'bullish', confidence: 68, vol: '450M' },
  { symbol: 'TIA', name: 'Celestia', price: 6.71, change: 5.71, score: 72, bias: 'bullish', confidence: 65, vol: '220M' }
];

const WHALE_ACTIONS = [
  { time: "2m ago", text: "$4.2M transferred to", type: "buy", amount: "SOL", exchange: "Binance" },
  { time: "5m ago", text: "Smart money accumulation detected on", type: "buy", amount: "LINK", exchange: "DEX" },
  { time: "12m ago", text: "$12.5M withdrawn from exchange", type: "buy", amount: "BTC", exchange: "Coinbase" },
  { time: "18m ago", text: "Institutional sized deposit made for", type: "sell", amount: "ETH", exchange: "Kraken" },
  { time: "24m ago", text: "$1.5M swapped to stablecoins from", type: "sell", amount: "ARB", exchange: "Uniswap" },
  { time: "31m ago", text: "Heavy accumulation spotted on", type: "buy", amount: "INJ", exchange: "Binance" }
];

const ALPHA_SIGNALS = [
  { time: "Just now", text: "Top trader 'Sisyphus' increased ETH exposure by 15%", impact: "high" },
  { time: "10m ago", text: "AI narrative gaining massive traction across institutional desks", impact: "high" },
  { time: "35m ago", text: "Smart money accumulating heavily in mid-cap DeFi", impact: "medium" },
  { time: "1h ago", text: "Unusual options activity: 10k SOL calls bought for EOM", impact: "high" }
];

const NEWS = [
  { time: "1h ago", title: "BlackRock files for new crypto ETF in Delaware", asset: "BTC", impact: "High" },
  { time: "2h ago", title: "SEC delays decision on Ethereum ETF options", asset: "ETH", impact: "Medium" },
  { time: "4h ago", title: "Arbitrum DAO approves $215M treasury allocation", asset: "ARB", impact: "High" },
  { time: "5h ago", title: "700M SUI tokens unlocked, causing minor sell pressure", asset: "SUI", impact: "Medium" },
  { time: "8h ago", title: "Circle launches native USDC on Solana mainnet", asset: "SOL", impact: "High" }
];

const SIGNALS = [
  { coin: 'SOL', signal: 'Breakout Above Resistance', tf: '4H', strength: 'Strong', conf: '89%' },
  { coin: 'LINK', signal: 'Bullish EMA Cross', tf: '1D', strength: 'Strong', conf: '82%' },
  { coin: 'INJ', signal: 'RSI Reversal', tf: '4H', strength: 'Medium', conf: '75%' },
  { coin: 'OP', signal: 'Support Flipped', tf: '1H', strength: 'Strong', conf: '80%' },
  { coin: 'SUI', signal: 'Volume Breakout', tf: '1D', strength: 'Strong', conf: '83%' },
  { coin: 'TIA', signal: 'MACD Bullish Cross', tf: '1D', strength: 'Medium', conf: '72%' }
];

const DEFI_POOLS = [
  { protocol: 'Aave', asset: 'USDC', type: 'Lending', apy: '8.62%', tvl: '$1.2B', risk: 'Low' },
  { protocol: 'Pendle', asset: 'eETH', type: 'Yield', apy: '21.34%', tvl: '$1.34B', risk: 'Medium' },
  { protocol: 'Hyperliquid', asset: 'HLP', type: 'LP Farming', apy: '17.85%', tvl: '$58.2M', risk: 'Medium' },
  { protocol: 'Beefy', asset: 'BNB-USDT', type: 'Vault', apy: '13.27%', tvl: '$223M', risk: 'Low' },
  { protocol: 'Olympus', asset: 'OHM', type: 'Staking', apy: '19.45%', tvl: '$48.7M', risk: 'Medium' }
];

const NARRATIVES = [
  { name: 'AI / Artificial Intelligence', change: '+22.7%', val: '82' },
  { name: 'Real World Assets (RWA)', change: '+18.1%', val: '78' },
  { name: 'DePIN', change: '+15.2%', val: '74' },
  { name: 'Layer 2 Scaling', change: '-12.8%', val: '71' }
];

let assets = [...ASSETS];

// --- Paper Trading Lab State ---
const PAPER_INITIAL_BALANCE = 100;
let paperBalance = JSON.parse(localStorage.getItem('nexus_balance') || PAPER_INITIAL_BALANCE);
let paperTrades = JSON.parse(localStorage.getItem('nexus_trades') || '[]');
let paperClosed = JSON.parse(localStorage.getItem('nexus_closed') || '[]');

function savePaperState() {
  localStorage.setItem('nexus_balance', JSON.stringify(paperBalance));
  localStorage.setItem('nexus_trades', JSON.stringify(paperTrades));
  localStorage.setItem('nexus_closed', JSON.stringify(paperClosed));
}

// Chart Instances
let mainMarketChart;
let socialChart;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  if (typeof feather !== 'undefined') feather.replace();
  
  const loadingScreen = document.getElementById('loading-screen');
  const mainApp = document.getElementById('main-app');
  const loadingBar = document.querySelector('.loading-bar');
  const statuses = [
    "Establishing secure WebSocket connection...", 
    "Syncing on-chain data providers...", 
    "Loading quantitative models...", 
    "Calibrating NLP engines..."
  ];
  
  let step = 0;
  const interval = setInterval(() => {
    step++;
    if (step < statuses.length) {
      document.getElementById('loading-status').textContent = statuses[step];
      loadingBar.style.width = `${(step / statuses.length) * 100}%`;
    } else {
      clearInterval(interval);
      loadingBar.style.width = '100%';
      setTimeout(() => {
        loadingScreen.style.opacity = '0';
        setTimeout(() => {
          loadingScreen.classList.add('hidden');
          mainApp.classList.remove('hidden');
          initApp();
        }, 500);
      }, 500);
    }
  }, 500);
});

function initApp() {
  setupSidebar();
  updateTime();
  setInterval(updateTime, 1000);
  
  // Setup Charts
  initCharts();

  // Initial renders
  renderDashboard();
  renderOpportunitiesPage();
  renderTradingPage();
  renderWhalePage();
  renderNewsPage();
  renderSentimentPage();
  renderTechnicalPage();
  renderDefiPage();
  setupCommandCenter();
  setupAiResearchChat();
  setupModals();
  setupTradingEvents();
  setupPaperTrading();
  
  // Sync live APIs
  syncLiveApis();
  
  // Heartbeat: update paper trade P&L every 5 seconds
  setInterval(simulateMarketTick, 3000);
  setInterval(refreshPaperPnL, 5000);
}

// --- Charts Setup (Chart.js) ---
function initCharts() {
  // Chart defaults for dark mode
  Chart.defaults.color = '#94A3B8';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.scale.grid.color = 'rgba(255, 255, 255, 0.05)';
  
  // Main Market Trend Chart (Dashboard)
  const ctxMain = document.getElementById('mainMarketChart').getContext('2d');
  
  // Create gradient
  const gradient = ctxMain.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(108, 92, 231, 0.5)');
  gradient.addColorStop(1, 'rgba(108, 92, 231, 0.0)');

  // Generate mock random walk data
  let dataPoints = [];
  let currentVal = 2.80; // Trillions
  for(let i=0; i<48; i++) {
    currentVal += (Math.random() - 0.45) * 0.05; // slight upward drift
    dataPoints.push(currentVal);
  }

  mainMarketChart = new Chart(ctxMain, {
    type: 'line',
    data: {
      labels: Array.from({length: 48}, (_, i) => `${Math.floor(i/2)}h ago`).reverse(),
      datasets: [{
        label: 'Total Market Cap (T)',
        data: dataPoints,
        borderColor: '#6C5CE7',
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { 
          position: 'right',
          ticks: { callback: (value) => '$' + value.toFixed(2) + 'T' }
        }
      },
      interaction: { intersect: false, mode: 'index' }
    }
  });

  // Social Volume Chart (Sentiment Page)
  const ctxSocial = document.getElementById('socialChart').getContext('2d');
  const gradientSocial = ctxSocial.createLinearGradient(0, 0, 0, 200);
  gradientSocial.addColorStop(0, 'rgba(0, 230, 118, 0.3)');
  gradientSocial.addColorStop(1, 'rgba(0, 230, 118, 0.0)');

  let socialData = [];
  let sVal = 50;
  for(let i=0; i<24; i++) {
     sVal += (Math.random() - 0.4) * 10;
     socialData.push(sVal);
  }

  socialChart = new Chart(ctxSocial, {
    type: 'line',
    data: {
      labels: Array.from({length: 24}, (_, i) => `${i}h`),
      datasets: [{
        label: 'Social Mentions Index',
        data: socialData,
        borderColor: '#00E676',
        backgroundColor: gradientSocial,
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
}

function updateChartData() {
   // Push a new random point to main chart
   if(mainMarketChart) {
      const currentData = mainMarketChart.data.datasets[0].data;
      const lastVal = currentData[currentData.length - 1];
      const newVal = lastVal + (Math.random() - 0.48) * 0.02;
      
      currentData.shift();
      currentData.push(newVal);
      mainMarketChart.update('none'); // Update without animation for smooth tick
   }
}

async function syncLiveApis() {
  const statusEl = document.getElementById('market-time');
  if(statusEl) statusEl.textContent = "Syncing Live APIs...";
  
  try {
    const [marketData, sentiment, whales] = await Promise.all([
      fetchMarketData(),
      fetchSentiment(),
      fetchWhaleActivity()
    ]);

    if (marketData && marketData.length > 0) {
      assets = marketData.map(coin => {
         const symbol = coin.symbol.toUpperCase();
         const hasWhale = whales.some(w => w.value > 1); // Mock whale presence
         const techScore = coin.price_change_percentage_24h > 0 ? 1 : 0.5;
         const newsScore = sentiment.score > 50 ? 1 : 0.5;
         const volScore = coin.total_volume > 100000000 ? 1 : 0.5;
         
         const alpha = calculateAlphaScore(hasWhale, sentiment.score, techScore, newsScore, volScore, 0.8);
         
         return {
           symbol: symbol,
           name: coin.name,
           price: coin.current_price,
           change: coin.price_change_percentage_24h || 0,
           score: alpha,
           bias: alpha > 75 ? 'bullish' : (alpha < 50 ? 'bearish' : 'neutral'),
           confidence: Math.min(99, alpha + Math.floor(Math.random()*10)),
           vol: '$' + (coin.total_volume / 1e9).toFixed(1) + 'B'
         };
      });
      
      renderDashboard();
      renderOpportunitiesPage();
      if(statusEl) statusEl.textContent = "Live Feed Synced";
    }
  } catch(e) {
    console.error("Live sync failed", e);
  }
}

// --- Navigation ---
function setupSidebar() {
  const navContainer = document.getElementById('sidebar-nav');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle = document.getElementById('mobile-toggle');
  
  navContainer.innerHTML = NAV_ITEMS.map((item, index) => `
    <div class="nav-item ${index === 0 ? 'active' : ''}" data-page="${item.id}">
      <i data-feather="${item.icon}"></i>
      <span>${item.label}</span>
      ${item.badge ? `<span style="margin-left:auto;font-size:0.6rem;font-weight:800;padding:0.15rem 0.4rem;border-radius:4px;background:rgba(255,214,10,0.2);color:#FFD60A;border:1px solid rgba(255,214,10,0.4);">${item.badge}</span>` : ''}
    </div>
  `).join('');
  
  if (typeof feather !== 'undefined') feather.replace();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const pageId = e.currentTarget.dataset.page;
      navigateToPage(pageId);
      
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
      }
    });
  });

  // Cross-links
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      navigateToPage(e.currentTarget.dataset.target);
      
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
      }
    });
  });

  // Mobile Toggle Logic
  if (toggle && overlay) {
    toggle.addEventListener('click', () => {
      sidebar.classList.add('active');
      overlay.classList.add('active');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
    });
  }
}

function navigateToPage(pageId) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if(activeNav) activeNav.classList.add('active');
  
  const pageInfo = NAV_ITEMS.find(i => i.id === pageId);
  if (pageInfo) {
    document.getElementById('page-title').textContent = pageInfo.label;
  }
  
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });
  document.getElementById(`page-${pageId}`).classList.add('active');
}

function updateTime() {
  const now = new Date();
  document.getElementById('market-time').textContent = now.toLocaleTimeString('en-US', { hour12: false }) + ' UTC';
}

// --- Page Renders ---

function renderDashboard() {
  // Top Summaries
  document.getElementById('dashboard-summary').innerHTML = `
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Total Market Cap</span>
        <i data-feather="bar-chart-2" class="card-icon text-primary"></i>
      </div>
      <div class="card-value">$2.87T</div>
      <div class="card-change text-green">▲ 2.33%</div>
    </div>
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">BTC Dominance</span>
        <i data-feather="pie-chart" class="card-icon text-warning"></i>
      </div>
      <div class="card-value">54.2%</div>
      <div class="card-change text-muted">- 0.1%</div>
    </div>
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Alpha Target</span>
        <i data-feather="target" class="card-icon text-primary"></i>
      </div>
      <div class="card-value text-primary">SOL</div>
      <div class="card-change">Score: 89 • High Conviction</div>
    </div>
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Macro Sentiment</span>
        <i data-feather="activity" class="card-icon text-green"></i>
      </div>
      <div class="card-value text-green">Bullish</div>
      <div class="card-change text-muted">Upward Trend Detected</div>
    </div>
  `;
  if (typeof feather !== 'undefined') feather.replace();

  // Dash Opportunities Mini
  const dashOpps = document.getElementById('dash-opportunities-list');
  dashOpps.innerHTML = assets.slice(0, 5).map(asset => `
    <div class="asset-row">
      <div class="asset-info">
        <div class="asset-icon">${asset.symbol[0]}</div>
        <div class="asset-name-col">
          <span class="asset-name">${asset.symbol}</span>
          <span class="asset-symbol">Score: ${asset.score}</span>
        </div>
      </div>
      <div class="asset-price">$${formatPrice(asset.price)}</div>
      <div class="asset-change ${asset.change >= 0 ? 'text-green' : 'text-red'}">${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2)}%</div>
      <div class="bias-badge bias-${asset.bias}">${asset.bias}</div>
    </div>
  `).join('');

  // AI Mini with typing effect
  const aiContent = document.getElementById('dash-ai-research-content');
  aiContent.innerHTML = '';
  typeWriterEffect(aiContent, [
     "> Executive Summary: SOL",
     "> SOL shows strong bullish momentum backed by whale accumulation, positive sentiment and a technical breakout.",
     "> Thesis: SOL has broken above key resistance with increasing volume. On-chain data shows accumulation by smart money wallets and positive narrative across Solana ecosystem..."
  ]);

  // Whale Mini
  document.getElementById('dash-whale-list').innerHTML = WHALE_ACTIONS.slice(0,4).map(action => `
    <div class="feed-item whale-${action.type}">
      <div class="feed-header">
        <span class="feed-time">${action.time}</span>
        <span class="feed-tag">${action.type.toUpperCase()}</span>
      </div>
      <div class="feed-content">
        ${action.text} <span class="amount">${action.amount}</span>
      </div>
    </div>
  `).join('');

  // Alpha Mini
  const dashAlpha = document.getElementById('dash-alpha-list');
  if (dashAlpha) {
    dashAlpha.innerHTML = ALPHA_SIGNALS.slice(0,3).map(action => `
      <div class="feed-item news-impact">
        <div class="feed-header">
          <span class="feed-time">${action.time}</span>
          <span class="feed-tag" style="background: rgba(108, 92, 231, 0.2); color: var(--primary);">ALPHA</span>
        </div>
        <div class="feed-content">
          ${action.text}
        </div>
      </div>
    `).join('');
  }
}

function typeWriterEffect(element, lines, speed = 20) {
   element.innerHTML = '';
   let lineIdx = 0;
   
   function typeLine() {
      if (lineIdx >= lines.length) {
         element.innerHTML += '<span class="ai-cursor"></span>';
         return;
      }
      
      const lineText = lines[lineIdx];
      const lineDiv = document.createElement('div');
      lineDiv.className = lineIdx === 0 ? 'ai-line highlight' : 'ai-line';
      lineDiv.style.opacity = '1';
      element.appendChild(lineDiv);
      
      let charIdx = 0;
      function typeChar() {
         if (charIdx < lineText.length) {
            lineDiv.textContent += lineText.charAt(charIdx);
            charIdx++;
            setTimeout(typeChar, speed);
         } else {
            lineIdx++;
            setTimeout(typeLine, 100);
         }
      }
      typeChar();
   }
   
   typeLine();
}

function renderOpportunitiesPage() {
  const tbody = document.getElementById('opportunities-table-body');
  const sorted = [...assets].sort((a,b) => b.score - a.score);
  
  tbody.innerHTML = sorted.map((asset, i) => `
    <tr>
      <td class="text-muted">${i+1}</td>
      <td><strong>${asset.name}</strong> <span class="text-muted ml-2">${asset.symbol}</span></td>
      <td style="font-family: var(--font-mono)" class="live-price" data-symbol="${asset.symbol}">$${formatPrice(asset.price)}</td>
      <td class="${asset.change >= 0 ? 'text-green' : 'text-red'} live-change" data-symbol="${asset.symbol}">${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2)}%</td>
      <td>
        <div class="td-score-container">
          <span class="td-score-val">${asset.score}</span>
          <div class="td-score-bar-bg">
            <div class="td-score-bar-fill" style="width: ${asset.score}%"></div>
          </div>
        </div>
      </td>
      <td><span class="bias-badge bias-${asset.bias}">${asset.bias}</span></td>
      <td><span class="text-muted">${asset.confidence}%</span></td>
      <td><button class="action-btn">Analyze</button></td>
    </tr>
  `).join('');

  document.querySelectorAll('#opportunities-table-body .action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      const symbol = row.querySelector('.live-price').dataset.symbol;
      
      navigateToPage('command');
      
      const input = document.getElementById('command-input-large');
      const submitBtn = document.getElementById('command-submit-large');
      
      setTimeout(() => {
        input.value = `Give me a trade setup for ${symbol} with entry and exit targets`;
        submitBtn.click();
      }, 300);
    });
  });
}

function renderTradingPage(symbol = 'BINANCE:SOLUSDT') {
  if (typeof TradingView !== 'undefined') {
    new TradingView.widget({
      "autosize": true,
      "symbol": symbol,
      "interval": "D",
      "timezone": "Etc/UTC",
      "theme": "dark",
      "style": "1",
      "locale": "en",
      "enable_publishing": false,
      "backgroundColor": "#0E1320",
      "gridColor": "#1C2438",
      "hide_top_toolbar": false,
      "hide_legend": false,
      "save_image": false,
      "container_id": "tradingview-widget",
      "toolbar_bg": "#0E1320"
    });
  }
}

function setupTradingEvents() {
  const tvSelect = document.getElementById('tv-pair-select');
  if(tvSelect) {
     tvSelect.addEventListener('change', (e) => {
        renderTradingPage(e.target.value);
     });
  }
}

function renderWhalePage() {
  document.getElementById('whale-summary').innerHTML = `
    <div class="summary-card">
      <div class="card-header"><span class="card-title">24h Net Flow</span></div>
      <div class="card-value text-green">+$452.8M</div>
    </div>
    <div class="summary-card">
      <div class="card-header"><span class="card-title">Dominant Trend</span></div>
      <div class="card-value text-primary">Accumulation</div>
    </div>
    <div class="summary-card">
      <div class="card-header"><span class="card-title">Peak Transaction</span></div>
      <div class="card-value">12k ETH</div>
    </div>
  `;

  const tbody = document.getElementById('whale-table-body');
  tbody.innerHTML = WHALE_ACTIONS.map(w => `
    <tr>
      <td class="text-muted" style="font-family: var(--font-mono)">${w.time}</td>
      <td><strong>${w.amount}</strong></td>
      <td><span class="bias-badge bias-${w.type === 'buy' ? 'bullish' : 'bearish'}">${w.type === 'buy' ? 'Accumulation' : 'Distribution'}</span></td>
      <td style="font-family: var(--font-mono)">${Math.floor(Math.random() * 500) + 10}k ${w.amount}</td>
      <td style="font-family: var(--font-mono)">$${(Math.random() * 10 + 1).toFixed(1)}M</td>
      <td class="text-muted">${w.type === 'buy' ? w.exchange + ' -> Cold Storage' : 'Wallet -> ' + w.exchange}</td>
    </tr>
  `).join('');
}

function renderNewsPage() {
  document.getElementById('news-full-list').innerHTML = NEWS.map(n => `
    <div class="feed-item news-impact">
      <div class="feed-header">
        <span class="feed-time">${n.time}</span>
        <span class="feed-tag">Impact: ${n.impact}</span>
      </div>
      <div class="feed-content">
        <strong class="text-primary">${n.asset}</strong>: ${n.title}
      </div>
    </div>
  `).join('');

  document.getElementById('events-list').innerHTML = `
    <div class="feed-list">
      <div class="feed-item" style="border-left-color: var(--warning)"><div class="feed-time">Tomorrow</div><div class="feed-content">CPI Inflation Data Release</div></div>
      <div class="feed-item" style="border-left-color: var(--info)"><div class="feed-time">May 21</div><div class="feed-content">SUI Massive Token Unlock</div></div>
      <div class="feed-item" style="border-left-color: var(--primary)"><div class="feed-time">May 25</div><div class="feed-content">SEC Deadline on ETH ETF</div></div>
    </div>
  `;
}

function renderSentimentPage() {
  document.getElementById('narratives-list').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Narrative Focus</th><th>Momentum Score</th><th>24h Change</th></tr></thead>
      <tbody>
        ${NARRATIVES.map(n => `
          <tr>
            <td><strong>${n.name}</strong></td>
            <td>
              <div class="td-score-container">
                <span class="td-score-val">${n.val}</span>
                <div class="td-score-bar-bg"><div class="td-score-bar-fill" style="width: ${n.val}%"></div></div>
              </div>
            </td>
            <td class="${n.change.includes('+') ? 'text-green' : 'text-red'}">${n.change}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('dash-sentiment-stats').innerHTML = `
    <div class="sentiment-stat-row"><span class="sentiment-stat-label">Social Volume</span><span class="sentiment-stat-val text-green">+24.6%</span></div>
    <div class="sentiment-stat-row"><span class="sentiment-stat-label">Engagement Spike</span><span class="sentiment-stat-val text-green">+18.3%</span></div>
    <div class="sentiment-stat-row"><span class="sentiment-stat-label">Bearish Sentiment</span><span class="sentiment-stat-val text-red">-5.2%</span></div>
  `;
}

function renderTechnicalPage() {
  document.getElementById('technical-table-body').innerHTML = SIGNALS.map(s => `
    <tr>
      <td><strong>${s.coin}</strong></td>
      <td>${s.signal}</td>
      <td><span class="badge bg-primary">${s.tf}</span></td>
      <td><span class="text-${s.strength === 'Strong' ? 'green' : 'warning'}">${s.strength}</span></td>
      <td style="font-family: var(--font-mono)">${s.conf}</td>
      <td><button class="action-btn">View Chart</button></td>
    </tr>
  `).join('');
}

function renderDefiPage() {
  document.getElementById('defi-table-body').innerHTML = DEFI_POOLS.map(p => `
    <tr>
      <td><strong>${p.protocol}</strong></td>
      <td>${p.asset}</td>
      <td><span class="text-muted">${p.type}</span></td>
      <td class="text-green" style="font-family: var(--font-mono)">${p.apy}</td>
      <td style="font-family: var(--font-mono)">${p.tvl}</td>
      <td><span class="badge bg-${p.risk === 'Low' ? 'green' : 'warning'}">${p.risk}</span></td>
    </tr>
  `).join('');
}

function setupCommandCenter() {
  const input = document.getElementById('command-input-large');
  const btn = document.getElementById('command-submit-large');
  const res = document.getElementById('command-response-large');

  const handleCommand = () => {
    const val = input.value.trim();
    if(!val) return;
    
    // Create query block
    const queryBlock = document.createElement('div');
    queryBlock.className = 'cmd-res-block';
    queryBlock.style.marginTop = '2rem';
    queryBlock.innerHTML = `<span class="command-prompt">root@nexus:~#</span> <span style="color:#fff">${val}</span>`;
    res.appendChild(queryBlock);
    
    // Create loading block
    const loadingBlock = document.createElement('div');
    loadingBlock.className = 'cmd-res-block text-muted';
    loadingBlock.innerHTML = `> Engaging Dual AI Engine (Hermes + GPT)... <span class="ai-cursor"></span>`;
    res.appendChild(loadingBlock);
    
    input.value = '';
    res.scrollTop = res.scrollHeight;

    setTimeout(async () => {
      // Fire Dual AI: Hermes (prediction) + OpenAI (analysis) in parallel
      const assetContext = assets.slice(0,3).map(a => `${a.symbol}:$${a.price}(${a.change>0?'+':''}${a.change.toFixed(1)}%)`).join(', ');
      const dualRes = await fetchDualAI(val, `Live market data — ${assetContext}`);
      
      res.removeChild(loadingBlock);
      
      const responseBlock = document.createElement('div');
      responseBlock.className = 'cmd-res-block';
      responseBlock.style.border = '1px solid var(--border-color)';
      responseBlock.style.background = 'rgba(0,0,0,0.3)';
      responseBlock.style.padding = '1.5rem';
      responseBlock.style.borderRadius = '8px';
      responseBlock.style.marginTop = '1rem';
      
      if (dualRes) {
         responseBlock.innerHTML = `
            <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:1rem;text-transform:uppercase;">⚡ Dual AI Engine Response</div>
            ${dualRes}
         `;
      } else {
        // Fallback to local logic
      
      // Look for specific coins and intents in query
      const upperVal = val.toUpperCase();
      const isTradeRequest = upperVal.includes('BEST') || upperVal.includes('BUY') || upperVal.includes('ENTRY') || upperVal.includes('EXIT') || upperVal.includes('TRADE') || upperVal.includes('SIGNAL') || upperVal.includes('SETUP');
      let targetAsset = assets.find(a => upperVal.includes(a.symbol));
      
      // If asking for "best coin" and no coin was named, pick the highest alpha
      if (!targetAsset && isTradeRequest) {
         targetAsset = [...assets].sort((a,b) => b.score - a.score)[0];
      }

      if (targetAsset && isTradeRequest) {
          const entryPrice = targetAsset.price;
          const tp1 = entryPrice * 1.05;
          const tp2 = entryPrice * 1.12;
          const sl = entryPrice * 0.96;
          
          responseBlock.innerHTML = `
            <div class="text-primary mb-2" style="margin-bottom: 1rem; font-weight: 700;">Quant Trade Setup: ${targetAsset.symbol}/USDT</div>
            <div style="margin-bottom: 1.5rem; color: #a9b1d6; line-height: 1.6;">
               Based on our predictive models, <strong style="color: #fff">${targetAsset.name}</strong> exhibits a high Alpha Score of <strong class="text-green">${targetAsset.score}/100</strong>. Institutional flow is highly bullish. Here is the calculated algorithmic trade plan:
            </div>
            <div style="background: rgba(0,230,118,0.1); border-left: 3px solid var(--green); padding: 1rem; margin-bottom: 1rem; border-radius: 4px;">
               <div style="margin-bottom: 0.5rem;"><strong class="text-green" style="display:inline-block; width: 130px;">ENTRY ZONE:</strong> <span style="font-family: var(--font-mono); font-weight: 600;">$${formatPrice(entryPrice * 0.99)} - $${formatPrice(entryPrice * 1.01)}</span></div>
               <div style="margin-bottom: 0.5rem;"><strong class="text-primary" style="display:inline-block; width: 130px;">TAKE PROFIT 1:</strong> <span style="font-family: var(--font-mono)">$${formatPrice(tp1)}</span> (+5.0%)</div>
               <div style="margin-bottom: 0.5rem;"><strong class="text-primary" style="display:inline-block; width: 130px;">TAKE PROFIT 2:</strong> <span style="font-family: var(--font-mono)">$${formatPrice(tp2)}</span> (+12.0%)</div>
               <div><strong class="text-red" style="display:inline-block; width: 130px;">STOP LOSS:</strong> <span style="font-family: var(--font-mono)">$${formatPrice(sl)}</span> (-4.0%)</div>
            </div>
            <div><span class="text-muted">Model Confidence:</span> <span class="text-green" style="font-weight: 700;">${targetAsset.confidence}%</span> &nbsp;|&nbsp; <span class="text-muted">Time Horizon:</span> <span style="color: #fff">1D-3D Swing</span></div>
          `;
      } else if (targetAsset) {
         responseBlock.innerHTML = `
            <div class="text-primary mb-2" style="margin-bottom: 1rem; font-weight: 700;">Deep Analysis: ${targetAsset.name} (${targetAsset.symbol})</div>
            <div style="margin-bottom: 0.5rem;"><span class="text-muted" style="display:inline-block; width: 140px;">Current Price:</span> <span style="font-family: var(--font-mono)">$${formatPrice(targetAsset.price)}</span></div>
            <div style="margin-bottom: 0.5rem;"><span class="text-muted" style="display:inline-block; width: 140px;">Alpha Score:</span> <span class="text-green">${targetAsset.score}/100</span> (Confidence: ${targetAsset.confidence}%)</div>
            <div style="margin-bottom: 1rem;"><span class="text-muted" style="display:inline-block; width: 140px;">Directional Bias:</span> <span class="bias-badge bias-${targetAsset.bias}">${targetAsset.bias.toUpperCase()}</span></div>
            <p style="line-height: 1.6; color: #a9b1d6;">Our models detect massive on-chain accumulation for ${targetAsset.symbol}. Support has been flipped to resistance on the 4H chart, aligning with a positive sentiment divergence.</p>
         `;
      } else {
         const bestAlt = [...assets].sort((a,b) => b.score - a.score)[0];
         responseBlock.innerHTML = `
            <div class="text-primary mb-2" style="margin-bottom: 1rem; font-weight: 700;">Market Synthesis Complete</div>
            <div style="margin-bottom: 1rem; color: #a9b1d6; line-height: 1.6;">
              Based on live algorithmic scans across all supported networks, the current best opportunity is <strong class="text-green">${bestAlt.symbol}</strong> with an Alpha Score of ${bestAlt.score}/100.
            </div>
            <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 4px; font-family: var(--font-mono);">
              > Type <span class="text-primary">"Give me entry for ${bestAlt.symbol}"</span> for precise trading targets.
            </div>
         `;
      }
      }
      
      res.appendChild(responseBlock);
      res.scrollTop = res.scrollHeight;
    }, 100); // reduced timeout since we are awaiting fetch
  };

  btn.addEventListener('click', handleCommand);
  input.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') handleCommand();
  });
}

function setupAiResearchChat() {
  const input = document.getElementById('ai-chat-input');
  const btn = document.getElementById('ai-chat-submit');
  const history = document.getElementById('ai-chat-history');

  if (!input || !btn || !history) return;

  const handleChat = async () => {
    const val = input.value.trim();
    if(!val) return;
    
    // Add user message
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-message user';
    userMsg.style.flexDirection = 'row-reverse';
    userMsg.innerHTML = `
      <div class="avatar" style="background: rgba(255,255,255,0.1);"><i data-feather="user"></i></div>
      <div class="bubble" style="background: var(--primary-gradient); color: #fff;">${val}</div>
    `;
    history.appendChild(userMsg);
    if (typeof feather !== 'undefined') feather.replace();
    
    input.value = '';
    history.scrollTop = history.scrollHeight;

    // Add loading indicator
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'chat-message ai';
    loadingMsg.innerHTML = `
      <div class="avatar"><i data-feather="cpu"></i></div>
      <div class="bubble"><span class="ai-cursor"></span> Synthesizing data...</div>
    `;
    history.appendChild(loadingMsg);
    if (typeof feather !== 'undefined') feather.replace();
    history.scrollTop = history.scrollHeight;

    // Fetch from Dual AI (Hermes + GPT)
    const assetCtx = assets.slice(0,3).map(a => `${a.symbol}:$${a.price}`).join(', ');
    const dualRes = await fetchDualAI(val, `Live data — ${assetCtx}`);

    history.removeChild(loadingMsg);

    const aiMsg = document.createElement('div');
    aiMsg.className = 'chat-message ai';
    
    if (dualRes) {
      aiMsg.innerHTML = `
        <div class="avatar"><i data-feather="cpu"></i></div>
        <div class="bubble">${dualRes}</div>
      `;
    } else {
      aiMsg.innerHTML = `
        <div class="avatar"><i data-feather="cpu"></i></div>
        <div class="bubble text-red">Error: AI Engine offline or rate limited. Please try again.</div>
      `;
    }
    
    history.appendChild(aiMsg);
    if (typeof feather !== 'undefined') feather.replace();
    history.scrollTop = history.scrollHeight;
  };

  btn.addEventListener('click', handleChat);
  input.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') handleChat();
  });
}

function setupModals() {
  const modal = document.getElementById('alert-modal');
  
  const openModal = () => modal.classList.add('active');
  const closeModal = () => modal.classList.remove('active');

  document.getElementById('alert-btn').addEventListener('click', openModal);
  document.getElementById('new-alert-page-btn')?.addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if(e.target === modal) closeModal(); });

  document.getElementById('create-alert-btn').addEventListener('click', () => {
    closeModal();
    showToast('Algorithmic trigger deployed successfully.');
  });
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i data-feather="check-circle" class="toast-icon"></i><span class="toast-msg">${msg}</span>`;
  container.appendChild(toast);
  if (typeof feather !== 'undefined') feather.replace();
  
  setTimeout(() => { if(container.contains(toast)) container.removeChild(toast); }, 3000);
}

function simulateMarketTick() {
  assets = assets.map(a => {
    // Random walk
    const move = (Math.random() - 0.5) * 0.4;
    return {
      ...a,
      price: a.price * (1 + (move/100)),
      change: a.change + (move * 0.1)
    };
  });
  
  // Update Charts
  updateChartData();
  
  // Update UI Elements softly
  document.querySelectorAll('.live-price').forEach(el => {
     const symbol = el.dataset.symbol;
     const asset = assets.find(a => a.symbol === symbol);
     if(asset) {
        // Flash effect
        el.style.color = '#fff';
        el.textContent = `$${formatPrice(asset.price)}`;
        setTimeout(() => el.style.color = '', 300);
     }
  });

  document.querySelectorAll('.live-change').forEach(el => {
     const symbol = el.dataset.symbol;
     const asset = assets.find(a => a.symbol === symbol);
     if(asset) {
        el.textContent = `${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2)}%`;
        el.className = `live-change ${asset.change >= 0 ? 'text-green' : 'text-red'}`;
     }
  });
}

function formatPrice(num) {
  if (num < 1) return num.toFixed(4);
  if (num < 10) return num.toFixed(3);
  if (num < 1000) return num.toFixed(2);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================
// PAPER TRADING LAB — Beta Feature
// ============================================================

function setupPaperTrading() {
  renderPaperTradingPage();
}

function getCurrentPrice(symbol) {
  const asset = assets.find(a => a.symbol === symbol);
  return asset ? asset.price : null;
}

function executePaperTrade(symbol, tradeType, amount) {
  const asset = assets.find(a => a.symbol === symbol);
  if (!asset) return null;

  const entryPrice = asset.price;
  const qty = amount / entryPrice;
  const now = Date.now();

  // Set targets based on trade type
  const targets = {
    scalp: { tp: entryPrice * 1.015, sl: entryPrice * 0.990, label: 'Scalp (15m-1H)',  holdMs: 60 * 60 * 1000 },
    day:   { tp: entryPrice * 1.040, sl: entryPrice * 0.975, label: 'Day Trade (1H-24H)', holdMs: 24 * 60 * 60 * 1000 },
    swing: { tp: entryPrice * 1.100, sl: entryPrice * 0.960, label: 'Swing Trade (1-7D)',  holdMs: 7 * 24 * 60 * 60 * 1000 }
  };

  const t = targets[tradeType];
  const trade = {
    id: now,
    symbol,
    name: asset.name,
    tradeType,
    tradeLabel: t.label,
    entryPrice,
    qty,
    amount,
    tp: t.tp,
    sl: t.sl,
    openedAt: now,
    expiresAt: now + t.holdMs,
    status: 'open',
    aiScore: asset.score,
    aiBias: asset.bias
  };

  paperTrades.push(trade);
  paperBalance -= amount;
  savePaperState();
  renderPaperTradingPage();

  return trade;
}

function closePaperTrade(tradeId, reason = 'manual') {
  const idx = paperTrades.findIndex(t => t.id === tradeId);
  if (idx === -1) return;

  const trade = paperTrades[idx];
  const currentPrice = getCurrentPrice(trade.symbol) || trade.entryPrice;
  const currentValue = trade.qty * currentPrice;
  const pnl = currentValue - trade.amount;
  const pnlPct = (pnl / trade.amount) * 100;

  const closed = {
    ...trade,
    exitPrice: currentPrice,
    exitValue: currentValue,
    pnl,
    pnlPct,
    closedAt: Date.now(),
    closeReason: reason,
    status: 'closed'
  };

  paperClosed.push(closed);
  paperBalance += currentValue;
  paperTrades.splice(idx, 1);
  savePaperState();
  renderPaperTradingPage();
}

function refreshPaperPnL() {
  // Auto-close trades that hit TP, SL, or expire
  const toClose = [];
  paperTrades.forEach(trade => {
    const price = getCurrentPrice(trade.symbol);
    if (!price) return;

    if (price >= trade.tp) toClose.push({ id: trade.id, reason: '✅ Take Profit Hit' });
    else if (price <= trade.sl) toClose.push({ id: trade.id, reason: '🛑 Stop Loss Hit' });
    else if (Date.now() > trade.expiresAt) toClose.push({ id: trade.id, reason: '⏰ Trade Expired' });
  });

  toClose.forEach(({ id, reason }) => closePaperTrade(id, reason));

  // Just refresh UI if no closures
  if (toClose.length === 0 && document.getElementById('page-paper-trading')?.classList.contains('active')) {
    renderOpenPositions();
    renderPaperStats();
  }
}

function renderPaperTradingPage() {
  const page = document.getElementById('page-paper-trading');
  if (!page) return;

  const totalInvested = paperTrades.reduce((s, t) => s + t.amount, 0);
  const totalClosedPnl = paperClosed.reduce((s, t) => s + t.pnl, 0);
  const totalReturn = (totalClosedPnl / PAPER_INITIAL_BALANCE) * 100;

  // Stats per trade type
  const typeStats = {};
  ['scalp', 'day', 'swing'].forEach(type => {
    const trades = paperClosed.filter(t => t.tradeType === type);
    const wins = trades.filter(t => t.pnl > 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const avgPct = trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0;
    typeStats[type] = { trades: trades.length, wins: wins.length, totalPnl, avgPct };
  });

  const bestAsset = [...assets].sort((a, b) => b.score - a.score)[0];

  page.innerHTML = `
    <!-- BETA Banner -->
    <div style="background:linear-gradient(135deg,rgba(255,214,10,0.1),rgba(255,214,10,0.03));border:1px solid rgba(255,214,10,0.3);border-radius:12px;padding:1rem 1.5rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:1rem;">
      <span style="font-size:1.5rem;">🧪</span>
      <div>
        <div style="font-weight:800;color:#FFD60A;font-size:0.9rem;letter-spacing:0.05em;">BETA FEATURE — Paper Trading Lab</div>
        <div style="color:var(--text-muted);font-size:0.8rem;margin-top:0.2rem;">Simulate $100 trades using live AI signals. No real funds. Tracks your platform's actual prediction accuracy.</div>
      </div>
    </div>

    <!-- Portfolio Summary Row -->
    <div class="summary-row" style="margin-bottom:1.5rem;">
      <div class="summary-card">
        <div class="card-header"><span class="card-title">Paper Balance</span><i data-feather="dollar-sign" class="card-icon"></i></div>
        <div class="card-value text-green" id="pt-balance">$${paperBalance.toFixed(2)}</div>
        <div class="card-change ${totalReturn >= 0 ? 'text-green' : 'text-red'}">${totalReturn >= 0 ? '▲' : '▼'} ${Math.abs(totalReturn).toFixed(2)}% Total Return</div>
      </div>
      <div class="summary-card">
        <div class="card-header"><span class="card-title">Deployed Capital</span><i data-feather="zap" class="card-icon"></i></div>
        <div class="card-value text-primary">$${totalInvested.toFixed(2)}</div>
        <div class="card-change text-muted">${paperTrades.length} Open Position${paperTrades.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="summary-card">
        <div class="card-header"><span class="card-title">Realized P&L</span><i data-feather="trending-up" class="card-icon"></i></div>
        <div class="card-value ${totalClosedPnl >= 0 ? 'text-green' : 'text-red'}">${totalClosedPnl >= 0 ? '+' : ''}$${totalClosedPnl.toFixed(2)}</div>
        <div class="card-change text-muted">${paperClosed.length} Completed Trade${paperClosed.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="summary-card">
        <div class="card-header"><span class="card-title">Win Rate</span><i data-feather="award" class="card-icon"></i></div>
        <div class="card-value text-primary">${paperClosed.length ? Math.round((paperClosed.filter(t => t.pnl > 0).length / paperClosed.length) * 100) : 0}%</div>
        <div class="card-change text-muted">Across All Trade Types</div>
      </div>
    </div>

    <!-- Trade Type Performance -->
    <div class="panel" style="margin-bottom:1.5rem;">
      <div class="panel-header">
        <h2 class="panel-title"><i data-feather="bar-chart-2"></i> Strategy Performance Breakdown</h2>
      </div>
      <div class="panel-body" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;">
        ${['scalp','day','swing'].map(type => {
          const s = typeStats[type];
          const wr = s.trades ? Math.round((s.wins / s.trades) * 100) : 0;
          const icons = { scalp: '⚡', day: '☀️', swing: '🌊' };
          const labels = { scalp: 'Scalp (15m-1H)', day: 'Day Trade (1H-24H)', swing: 'Swing (1-7D)' };
          const color = s.avgPct >= 0 ? 'var(--green)' : 'var(--red)';
          return `
            <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:12px;padding:1.5rem;text-align:center;">
              <div style="font-size:2rem;margin-bottom:0.5rem;">${icons[type]}</div>
              <div style="font-weight:700;font-size:1rem;margin-bottom:1rem;">${labels[type]}</div>
              <div style="font-size:2rem;font-weight:900;font-family:var(--font-mono);color:${color};margin-bottom:0.25rem;">${s.avgPct >= 0 ? '+' : ''}${s.avgPct.toFixed(2)}%</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1rem;">Avg Return Per Trade</div>
              <div style="display:flex;justify-content:space-between;font-size:0.8rem;">
                <span style="color:var(--text-muted);">Trades: <strong style="color:#fff;">${s.trades}</strong></span>
                <span style="color:var(--text-muted);">Win Rate: <strong style="color:var(--green);">${wr}%</strong></span>
              </div>
              <div style="margin-top:1rem;">
                <div style="height:4px;background:rgba(0,0,0,0.4);border-radius:4px;overflow:hidden;">
                  <div style="height:100%;width:${wr}%;background:var(--primary-gradient);border-radius:4px;"></div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Deploy New Trade -->
    <div class="panel" style="margin-bottom:1.5rem;">
      <div class="panel-header">
        <h2 class="panel-title"><i data-feather="zap"></i> Deploy AI Signal Trade</h2>
        <span class="panel-badge ai-badge">NEXUS SIGNALS</span>
      </div>
      <div class="panel-body">
        <div style="background:rgba(139,120,255,0.05);border:1px solid rgba(139,120,255,0.2);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:1rem;">
          <div style="font-size:1.5rem;">🎯</div>
          <div style="flex:1;">
            <div style="font-weight:700;color:#fff;">Top AI Signal: <span class="text-primary">${bestAsset?.symbol || 'N/A'}</span> — Alpha Score <span class="text-green">${bestAsset?.score || '—'}/100</span></div>
            <div style="color:var(--text-muted);font-size:0.85rem;margin-top:0.2rem;">Bias: <span class="bias-badge bias-${bestAsset?.bias || 'neutral'}" style="font-size:0.65rem;">${(bestAsset?.bias || 'neutral').toUpperCase()}</span> &nbsp;|&nbsp; Current Price: <span style="font-family:var(--font-mono);">$${bestAsset ? formatPrice(bestAsset.price) : '—'}</span></div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1rem;" id="trade-form">
          <div>
            <label style="display:block;color:var(--text-muted);font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;">Select Asset</label>
            <select id="pt-asset" class="form-select">
              ${assets.map(a => `<option value="${a.symbol}" ${a.symbol === bestAsset?.symbol ? 'selected' : ''}>${a.symbol} — ${a.name} (Score: ${a.score})</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;color:var(--text-muted);font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;">Trade Type</label>
            <select id="pt-type" class="form-select">
              <option value="scalp">⚡ Scalp (TP: +1.5% | SL: -1.0%)</option>
              <option value="day" selected>☀️ Day Trade (TP: +4.0% | SL: -2.5%)</option>
              <option value="swing">🌊 Swing (TP: +10% | SL: -4.0%)</option>
            </select>
          </div>
          <div>
            <label style="display:block;color:var(--text-muted);font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;">Amount (USD)</label>
            <input type="number" id="pt-amount" class="form-input" value="25" min="1" max="${paperBalance.toFixed(0)}" step="1" placeholder="e.g. 25"/>
          </div>
        </div>
        <div style="display:flex;gap:1rem;align-items:center;">
          <button id="pt-execute-btn" class="btn-primary" style="min-width:200px;">
            <i data-feather="zap"></i> Execute Paper Trade
          </button>
          <button id="pt-ai-btn" class="btn-secondary">
            <i data-feather="cpu"></i> Let AI Pick Best Setup
          </button>
          <span style="color:var(--text-muted);font-size:0.85rem;">Available: <strong style="color:#fff;">$${paperBalance.toFixed(2)}</strong></span>
        </div>
      </div>
    </div>

    <!-- Open Positions -->
    <div class="panel" style="margin-bottom:1.5rem;" id="open-positions-panel">
      <div class="panel-header">
        <h2 class="panel-title"><i data-feather="activity"></i> Open Positions</h2>
        <span style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-muted);">${paperTrades.length} active</span>
      </div>
      <div id="open-positions-body">
        ${renderOpenPositionsHTML()}
      </div>
    </div>

    <!-- Trade History -->
    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title"><i data-feather="list"></i> Closed Trade History</h2>
        ${paperClosed.length > 0 ? `<button id="pt-reset-btn" style="background:rgba(255,51,102,0.1);border:1px solid var(--red-glow);color:var(--red);padding:0.4rem 0.85rem;border-radius:6px;font-size:0.8rem;cursor:pointer;font-weight:600;">Reset Lab</button>` : ''}
      </div>
      <div class="panel-body table-responsive">
        ${paperClosed.length === 0 ? `<div style="text-align:center;padding:3rem;color:var(--text-muted);">No closed trades yet. Execute your first paper trade above!</div>` : `
        <table class="data-table">
          <thead><tr>
            <th>Asset</th><th>Type</th><th>Entry</th><th>Exit</th>
            <th>P&L</th><th>Return %</th><th>Close Reason</th>
          </tr></thead>
          <tbody>
            ${[...paperClosed].reverse().map(t => `
              <tr>
                <td><strong>${t.symbol}</strong></td>
                <td><span style="font-size:0.75rem;">${t.tradeLabel}</span></td>
                <td style="font-family:var(--font-mono);">$${formatPrice(t.entryPrice)}</td>
                <td style="font-family:var(--font-mono);">$${formatPrice(t.exitPrice)}</td>
                <td class="${t.pnl >= 0 ? 'text-green' : 'text-red'}" style="font-family:var(--font-mono);font-weight:700;">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</td>
                <td class="${t.pnlPct >= 0 ? 'text-green' : 'text-red'}" style="font-family:var(--font-mono);font-weight:700;">${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%</td>
                <td style="font-size:0.8rem;color:var(--text-muted);">${t.closeReason}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
      </div>
    </div>
  `;

  if (typeof feather !== 'undefined') feather.replace();

  // Wire up buttons
  document.getElementById('pt-execute-btn')?.addEventListener('click', () => {
    const sym = document.getElementById('pt-asset').value;
    const type = document.getElementById('pt-type').value;
    const amt = parseFloat(document.getElementById('pt-amount').value);

    if (isNaN(amt) || amt <= 0) return alert('Enter a valid amount.');
    if (amt > paperBalance) return alert(`Insufficient balance. Available: $${paperBalance.toFixed(2)}`);

    const trade = executePaperTrade(sym, type, amt);
    if (trade) {
      showToast(`📈 Paper trade opened: $${amt} on ${trade.symbol} (${trade.tradeLabel})`);
    }
  });

  document.getElementById('pt-ai-btn')?.addEventListener('click', () => {
    const best = [...assets].sort((a, b) => b.score - a.score)[0];
    if (!best) return;
    document.getElementById('pt-asset').value = best.symbol;
    document.getElementById('pt-type').value = best.score > 80 ? 'swing' : 'day';
    document.getElementById('pt-amount').value = Math.min(25, paperBalance).toFixed(0);
    showToast(`🤖 AI selected ${best.symbol} with score ${best.score}. Review and click Execute.`);
  });

  document.getElementById('pt-reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset the Paper Trading Lab? All history will be cleared.')) {
      paperBalance = PAPER_INITIAL_BALANCE;
      paperTrades = [];
      paperClosed = [];
      savePaperState();
      renderPaperTradingPage();
      showToast('🔄 Paper Trading Lab reset. Starting fresh with $100.');
    }
  });

  // Wire close buttons
  document.querySelectorAll('.close-trade-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      closePaperTrade(id, '🤚 Manual Close');
      showToast('Trade closed manually.');
    });
  });
}

function renderOpenPositionsHTML() {
  if (paperTrades.length === 0) {
    return `<div style="text-align:center;padding:2rem;color:var(--text-muted);">No open positions. Deploy a trade above.</div>`;
  }

  return `
    <div class="panel-body table-responsive">
      <table class="data-table">
        <thead><tr>
          <th>Asset</th><th>Type</th><th>Entry</th><th>Current</th>
          <th>TP / SL</th><th>Unrealized P&L</th><th>Action</th>
        </tr></thead>
        <tbody>
          ${paperTrades.map(t => {
            const currentPrice = getCurrentPrice(t.symbol) || t.entryPrice;
            const currentValue = t.qty * currentPrice;
            const pnl = currentValue - t.amount;
            const pnlPct = (pnl / t.amount) * 100;
            const timeLeft = Math.max(0, t.expiresAt - Date.now());
            const hoursLeft = (timeLeft / 3600000).toFixed(1);

            return `
              <tr>
                <td><strong>${t.symbol}</strong> <div style="font-size:0.7rem;color:var(--text-muted);">AI: ${t.aiScore}/100</div></td>
                <td><span style="font-size:0.75rem;">${t.tradeLabel}</span></td>
                <td style="font-family:var(--font-mono);">$${formatPrice(t.entryPrice)}</td>
                <td style="font-family:var(--font-mono);">$${formatPrice(currentPrice)}</td>
                <td style="font-size:0.8rem;">
                  <div class="text-green">TP: $${formatPrice(t.tp)}</div>
                  <div class="text-red">SL: $${formatPrice(t.sl)}</div>
                </td>
                <td>
                  <div class="${pnl >= 0 ? 'text-green' : 'text-red'}" style="font-family:var(--font-mono);font-weight:700;font-size:1.1rem;">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</div>
                  <div class="${pnl >= 0 ? 'text-green' : 'text-red'}" style="font-family:var(--font-mono);font-size:0.8rem;">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</div>
                  <div style="font-size:0.7rem;color:var(--text-muted);">${hoursLeft}h left</div>
                </td>
                <td><button class="action-btn close-trade-btn" data-id="${t.id}">Close</button></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderOpenPositions() {
  const body = document.getElementById('open-positions-body');
  if (body) body.innerHTML = renderOpenPositionsHTML();

  // Re-wire close buttons
  document.querySelectorAll('.close-trade-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      closePaperTrade(id, '🤚 Manual Close');
      showToast('Trade closed manually.');
    });
  });
}

function renderPaperStats() {
  const el = document.getElementById('pt-balance');
  if (el) el.textContent = `$${paperBalance.toFixed(2)}`;
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i data-feather="check-circle" class="toast-icon"></i><span>${message}</span>`;
  container.appendChild(toast);
  if (typeof feather !== 'undefined') feather.replace();
  setTimeout(() => toast.remove(), 4000);
}

