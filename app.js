// app.js — Multi-Timeframe SMC Dashboard + Simulated Trade Journal

const BINANCE_API    = 'https://api.binance.com/api/v3/klines';
const TICKER_API     = 'https://api.binance.com/api/v3/ticker/price';
const TRADES_KEY     = 'smc_sim_trades';
const SHEETS_URL_KEY = 'smc_sheets_url';
const POLL_INTERVAL  = 60_000; // ms

let chart        = null;
let candleSeries = null;
let volSeries    = null;
let activePriceLines = [];

let currentSymbol   = 'BTCUSDT';
let currentInterval = '4h';
let latestReport    = null;
let pollingTimer    = null;

// ══════════════════════════════════════════════════════════════════
//  GOOGLE SHEETS 整合
//  - 使用記憶體快取（_tradesCache）讓所有函數保持同步
//  - 讀取：App 啟動時從 Sheets 初始化快取
//  - 寫入：同步到 localStorage，背景同步到 Sheets
// ══════════════════════════════════════════════════════════════════
let _tradesCache = null;

function getSheetsUrl() { return (localStorage.getItem(SHEETS_URL_KEY) || '').trim(); }
function setSheetsUrl(url) {
  localStorage.setItem(SHEETS_URL_KEY, url.trim());
  updateSheetsStatus('connecting');
  initTradesCache().then(() => {
    renderTradeLog();
    updateSheetsStatus(url.trim() ? 'ok' : 'none');
  });
}

// 從 Sheets（或 localStorage 備援）初始化快取
async function initTradesCache() {
  const url = getSheetsUrl();
  if (url) {
    try {
      const res  = await fetch(`${url}?t=${Date.now()}`);
      const data = await res.json();
      if (Array.isArray(data.trades)) {
        _tradesCache = data.trades;
        localStorage.setItem(TRADES_KEY, JSON.stringify(data.trades)); // 本地備份
        updateSheetsStatus('ok');
        return;
      }
    } catch (e) {
      console.warn('Sheets 讀取失敗，使用本地快取：', e);
      updateSheetsStatus('error');
    }
  }
  try { _tradesCache = JSON.parse(localStorage.getItem(TRADES_KEY) || '[]'); }
  catch { _tradesCache = []; }
}

// 讀（同步，從快取）
function loadTrades() {
  if (_tradesCache === null) {
    try { _tradesCache = JSON.parse(localStorage.getItem(TRADES_KEY) || '[]'); }
    catch { _tradesCache = []; }
  }
  return _tradesCache;
}

// 寫（同步到 localStorage + 背景推送 Sheets）
function saveTrades(trades) {
  _tradesCache = trades;
  localStorage.setItem(TRADES_KEY, JSON.stringify(trades));

  const url = getSheetsUrl();
  if (!url) return;

  // 背景同步，不阻塞 UI
  fetch(url, {
    method:  'POST',
    mode:    'no-cors',              // 避免 CORS preflight
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body:    JSON.stringify({ trades }),
  }).catch(e => console.warn('Sheets 寫入失敗：', e));
}

// 狀態指示器
function updateSheetsStatus(state) {
  const el = document.getElementById('sheets-status');
  if (!el) return;
  const map = {
    none:       ['—',       '#555'],
    connecting: ['連接中…', '#f39c12'],
    ok:         ['✓ 已連接', '#26a69a'],
    error:      ['✗ 連接失敗', '#ef5350'],
  };
  const [text, color] = map[state] || map.none;
  el.textContent  = text;
  el.style.color  = color;
}

function recordTrade() {
  if (!latestReport || latestReport.direction === 'WAIT' || !latestReport.setup) return;

  const r = latestReport;
  const trades = loadTrades();

  const trade = {
    id:         Date.now(),
    symbol:     currentSymbol,
    direction:  r.direction,
    entry:      r.setup.entry,
    sl:         r.setup.sl,
    tp1:        r.setup.tp1,
    tp2:        r.setup.tp2,
    rr1:        r.setup.rr1,
    rr2:        r.setup.rr2,
    confidence: r.confidence,
    trends:     r.trends,
    note:       r.narrative.slice(0, 120),
    openTime:   Date.now(),
    openPrice:  r.price,
    closeTime:  null,
    closePrice: null,
    status:     'open',   // open | tp1 | tp2 | sl | manual
    pnlPct:     null,
    tp1Hit:     false,    // partial: TP1 already hit
  };

  trades.unshift(trade);
  saveTrades(trades);
  renderTradeLog();

  // Expand trade section
  expandSec('trade-body');

  // Auto-start polling when a trade is recorded
  if (!pollingTimer) startPolling();

  // Flash button
  const btn = document.getElementById('record-btn');
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✓ 已記錄！';
    btn.style.cssText = 'background:#26a69a22;border-color:#26a69a;color:#26a69a';
    setTimeout(() => { btn.textContent = orig; btn.style.cssText = ''; }, 2000);
  }
}

function closeTrade(id, closePrice, status) {
  const trades = loadTrades();
  const trade  = trades.find(t => t.id === id);
  if (!trade || trade.status !== 'open') return;

  trade.closeTime  = Date.now();
  trade.closePrice = closePrice;
  trade.status     = status;
  trade.pnlPct     = trade.direction === 'LONG'
    ? ((closePrice - trade.entry) / trade.entry * 100).toFixed(2)
    : ((trade.entry - closePrice) / trade.entry * 100).toFixed(2);

  saveTrades(trades);
  renderTradeLog();
}

async function manualClose(id) {
  const trades = loadTrades();
  const trade  = trades.find(t => t.id === id);
  if (!trade) return;

  try {
    const res   = await fetch(`${TICKER_API}?symbol=${trade.symbol}`);
    const data  = await res.json();
    closeTrade(id, parseFloat(data.price), 'manual');
  } catch {
    const raw = prompt('無法自動取得價格，請手動輸入平倉價格：');
    if (raw && !isNaN(parseFloat(raw))) closeTrade(id, parseFloat(raw), 'manual');
  }
}

function deleteTrade(id) {
  if (!confirm('確定刪除此筆記錄？')) return;
  saveTrades(loadTrades().filter(t => t.id !== id));
  renderTradeLog();
}

function clearAllTrades() {
  if (!confirm('確定清空所有交易記錄？')) return;
  saveTrades([]);
  renderTradeLog();
}

// ══════════════════════════════════════════════════════════════════
//  AUTO PRICE POLLING
// ══════════════════════════════════════════════════════════════════
async function checkOpenTrades() {
  const trades  = loadTrades();
  const open    = trades.filter(t => t.status === 'open');
  if (!open.length) return;

  const symbols = [...new Set(open.map(t => t.symbol))];

  for (const sym of symbols) {
    try {
      const res   = await fetch(`${TICKER_API}?symbol=${sym}`);
      const data  = await res.json();
      const price = parseFloat(data.price);

      open.filter(t => t.symbol === sym).forEach(trade => {
        if (trade.direction === 'LONG') {
          if      (price <= trade.sl)  closeTrade(trade.id, price, 'sl');
          else if (price >= trade.tp2) closeTrade(trade.id, price, 'tp2');
          else if (price >= trade.tp1) closeTrade(trade.id, price, 'tp1');
        } else {
          if      (price >= trade.sl)  closeTrade(trade.id, price, 'sl');
          else if (price <= trade.tp2) closeTrade(trade.id, price, 'tp2');
          else if (price <= trade.tp1) closeTrade(trade.id, price, 'tp1');
        }
      });
    } catch (e) {
      console.warn('Price check failed:', sym, e);
    }
  }

  const el = document.getElementById('last-check');
  if (el) el.textContent = `${new Date().toLocaleTimeString('zh-TW')} 檢查`;
}

function startPolling() {
  if (pollingTimer) return;
  checkOpenTrades();
  pollingTimer = setInterval(checkOpenTrades, POLL_INTERVAL);
  updatePollingBtn(true);
}

function stopPolling() {
  clearInterval(pollingTimer);
  pollingTimer = null;
  updatePollingBtn(false);
}

function togglePolling() {
  pollingTimer ? stopPolling() : startPolling();
}

function updatePollingBtn(active) {
  const btn = document.getElementById('polling-btn');
  if (!btn) return;
  btn.textContent  = active ? '⏸ 停止巡價' : '▶ 開始巡價';
  btn.style.cssText = active
    ? 'background:#26a69a22;border-color:#26a69a;color:#26a69a'
    : '';
}

// ══════════════════════════════════════════════════════════════════
//  TRADE LOG RENDER
// ══════════════════════════════════════════════════════════════════
const STATUS_CFG = {
  open:   { label: '開倉中',  color: '#f39c12' },
  tp1:    { label: 'TP1 ✓', color: '#2ecc71'  },
  tp2:    { label: 'TP2 ✓', color: '#27ae60'  },
  sl:     { label: 'SL  ✗',  color: '#ef5350'  },
  manual: { label: '手動平', color: '#9b9ea8'  },
};

function renderTradeLog() {
  const trades = loadTrades();
  const closed = trades.filter(t => t.status !== 'open');
  const wins   = closed.filter(t => parseFloat(t.pnlPct) > 0).length;
  const totalPnl = closed.reduce((s, t) => s + parseFloat(t.pnlPct || 0), 0);
  const winRate  = closed.length ? (wins / closed.length * 100).toFixed(0) : '—';
  const avgRR    = closed.length
    ? (closed.reduce((s, t) => {
        const rr = t.status === 'tp2' ? parseFloat(t.rr2)
                 : t.status === 'tp1' ? parseFloat(t.rr1) : -1;
        return s + rr;
      }, 0) / closed.length).toFixed(1)
    : '—';

  const pnlColor  = totalPnl >= 0 ? '#2ecc71' : '#ef5350';
  const wrColor   = closed.length && wins / closed.length >= 0.5 ? '#2ecc71' : '#ef5350';

  document.getElementById('trade-stats').innerHTML = `
    <div class="stat-grid">
      <div class="stat-item">
        <div class="stat-value">${trades.length}</div>
        <div class="stat-label">總筆數</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="color:${wrColor}">${winRate}${closed.length ? '%' : ''}</div>
        <div class="stat-label">勝率</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="color:${pnlColor}">${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</div>
        <div class="stat-label">總盈虧</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="color:#9b9ea8">${avgRR}</div>
        <div class="stat-label">平均 R:R</div>
      </div>
    </div>`;

  const listEl = document.getElementById('trade-list');
  if (!trades.length) {
    listEl.innerHTML = '<div class="empty" style="padding:12px 0">尚無交易記錄<br><small>點「📝 記錄此策略」開始</small></div>';
    return;
  }

  listEl.innerHTML = trades.slice(0, 30).map(t => {
    const sc  = STATUS_CFG[t.status] || STATUS_CFG.manual;
    const dc  = t.direction === 'LONG' ? '#26a69a' : '#ef5350';
    const pnl = t.pnlPct
      ? `<span style="color:${parseFloat(t.pnlPct) >= 0 ? '#2ecc71' : '#ef5350'};font-weight:700">${parseFloat(t.pnlPct) >= 0 ? '+' : ''}${t.pnlPct}%</span>`
      : '<span style="color:#f39c12;font-size:10px">進行中</span>';

    const openDate  = new Date(t.openTime).toLocaleString('zh-TW', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    const closeDate = t.closeTime ? new Date(t.closeTime).toLocaleString('zh-TW', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : null;

    return `
    <div class="trade-card" style="border-left-color:${sc.color}">
      <div class="tc-head">
        <span style="color:${dc};font-weight:700;font-size:12px">${t.direction}</span>
        <span class="tc-sym">${t.symbol}</span>
        <span class="tc-badge" style="color:${sc.color};border-color:${sc.color}">${sc.label}</span>
        <span style="margin-left:auto">${pnl}</span>
      </div>
      <div class="tc-body">
        <div class="tc-row">
          <span class="dim">進場</span><span>$${fmt(t.entry)}</span>
          <span class="dim">SL</span><span style="color:#ef535099">$${fmt(t.sl)}</span>
          <span class="dim">TP1</span><span style="color:#2ecc7199">$${fmt(t.tp1)}</span>
          <span class="dim">TP2</span><span style="color:#27ae6099">$${fmt(t.tp2)}</span>
        </div>
        <div class="tc-row tc-row-2">
          <span class="dim">${openDate}</span>
          ${t.closePrice ? `<span class="dim">→</span><span class="dim">${closeDate}</span><span class="dim">@$${fmt(t.closePrice)}</span>` : ''}
          <span style="color:#555;font-size:10px">1D:${t.trends?.d1?.[0]?.toUpperCase()||'?'} 4H:${t.trends?.h4?.[0]?.toUpperCase()||'?'} 1H:${t.trends?.h1?.[0]?.toUpperCase()||'?'}</span>
          <span style="margin-left:auto;display:flex;gap:4px">
            ${t.status === 'open' ? `<button class="tc-btn tc-close" onclick="manualClose(${t.id})">平倉</button>` : ''}
            <button class="tc-btn tc-del" onclick="deleteTrade(${t.id})">✕</button>
          </span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════
//  FETCH
// ══════════════════════════════════════════════════════════════════
async function fetchKlines(symbol, interval, limit = 300) {
  const url = `${BINANCE_API}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || `HTTP ${res.status}`);
  }
  return parseBinanceKlines(await res.json());
}

// ══════════════════════════════════════════════════════════════════
//  CHART
// ══════════════════════════════════════════════════════════════════
function initChart() {
  const el = document.getElementById('chart');
  chart = LightweightCharts.createChart(el, {
    width:  el.clientWidth,
    height: el.clientHeight,
    layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
    grid:   { vertLines: { color: '#1e2330' }, horzLines: { color: '#1e2330' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2a2e39' },
    timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });

  volSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' }, priceScaleId: 'vol',
  });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

  window.addEventListener('resize', () => {
    chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
  });
}

function clearOverlays() {
  activePriceLines.forEach(({ series, line }) => { try { series.removePriceLine(line); } catch (_) {} });
  activePriceLines = [];
  candleSeries.setMarkers([]);
}
function addLine(opts) {
  activePriceLines.push({ series: candleSeries, line: candleSeries.createPriceLine(opts) });
}

function renderChartOverlays(analysis, mtfSetup) {
  clearOverlays();
  const { structure, orderBlocks, fvgs, equalLevels } = analysis;
  const LS = LightweightCharts.LineStyle;

  const markers = structure.events.slice(-15).map(e => ({
    time:     e.time,
    position: e.direction === 'bullish' ? 'belowBar' : 'aboveBar',
    color:    e.type === 'CHoCH' ? '#f39c12' : (e.direction === 'bullish' ? '#26a69a' : '#ef5350'),
    shape:    e.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
    text:     e.type, size: 1,
  }));
  candleSeries.setMarkers(markers.sort((a, b) => a.time - b.time));

  orderBlocks.bullishOBs.filter(o => o.active).slice(-3).forEach(o => {
    addLine({ price: o.high, color: '#26a69a', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true, title: '🟢 OB' });
    addLine({ price: o.low,  color: '#26a69a', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });
  orderBlocks.bearishOBs.filter(o => o.active).slice(-3).forEach(o => {
    addLine({ price: o.low,  color: '#ef5350', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true,  title: '🔴 OB' });
    addLine({ price: o.high, color: '#ef5350', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });
  equalLevels.eqHighs.slice(-2).forEach(e => addLine({ price: e.price, color: '#f1c40f', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true, title: 'EQH' }));
  equalLevels.eqLows .slice(-2).forEach(e => addLine({ price: e.price, color: '#f1c40f', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true, title: 'EQL' }));
  fvgs.bullish.filter(f => f.active).slice(-2).forEach(f => {
    addLine({ price: f.top,    color: '#1abc9c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true,  title: 'FVG↑' });
    addLine({ price: f.bottom, color: '#1abc9c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });
  fvgs.bearish.filter(f => f.active).slice(-2).forEach(f => {
    addLine({ price: f.bottom, color: '#e74c3c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true,  title: 'FVG↓' });
    addLine({ price: f.top,    color: '#e74c3c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });

  if (mtfSetup) {
    const { entry, sl, tp1, tp2 } = mtfSetup;
    addLine({ price: entry, color: '#3498db', lineWidth: 2, lineStyle: LS.Solid,  axisLabelVisible: true, title: '📍 Entry' });
    addLine({ price: sl,    color: '#e74c3c', lineWidth: 2, lineStyle: LS.Solid,  axisLabelVisible: true, title: '🛑 SL' });
    addLine({ price: tp1,   color: '#2ecc71', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true, title: '🎯 TP1' });
    addLine({ price: tp2,   color: '#27ae60', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true, title: '🎯 TP2' });
  }
}

// ══════════════════════════════════════════════════════════════════
//  MTF ANALYSIS
// ══════════════════════════════════════════════════════════════════
function buildMTFReport(d1, h4, h1) {
  const trends = { d1: d1.structure.trend, h4: h4.structure.trend, h1: h1.structure.trend };
  const price  = h1.bars[h1.bars.length - 1].close;
  const { d1: td1, h4: th4, h1: th1 } = trends;

  let direction, confidence, narrative, waitReason = '';

  if      (td1 === 'bullish' && th4 === 'bullish' && th1 === 'bullish') {
    direction = 'LONG';  confidence = 'high';
    narrative = '三框架多頭完全對齊。1D 確立大方向，4H 結構向上，1H 已翻多確認入場時機，可在 4H OB 回踩時積極進場。';
  } else if (td1 === 'bullish' && th4 === 'bullish' && th1 !== 'bullish') {
    direction = 'LONG';  confidence = 'medium';
    narrative = '1D 與 4H 均為多頭，大方向看漲。但 1H 尚未出現 CHoCH 翻多，建議等待 1H 結構確認後再進場，可降低被掃損風險。';
    waitReason = '等待 1H CHoCH 翻多';
  } else if (td1 === 'bullish' && th4 === 'bearish') {
    direction = 'WAIT'; confidence = 'low';
    narrative = '1D 為多頭大方向，但 4H 正在回踩調整，現在做多風險偏高。等待 4H 形成低點後出現 BOS 確認翻多，才是較安全的進場時機。';
    waitReason = '等待 4H 結構翻多';
  } else if (td1 === 'bearish' && th4 === 'bearish' && th1 === 'bearish') {
    direction = 'SHORT'; confidence = 'high';
    narrative = '三框架空頭完全對齊。1D 確立下行大方向，4H 結構向下，1H 已翻空確認入場時機，可在 4H OB 反彈時積極做空。';
  } else if (td1 === 'bearish' && th4 === 'bearish' && th1 !== 'bearish') {
    direction = 'SHORT'; confidence = 'medium';
    narrative = '1D 與 4H 均為空頭，大方向看跌。但 1H 尚未出現 CHoCH 翻空，建議等待 1H 結構確認後再做空。';
    waitReason = '等待 1H CHoCH 翻空';
  } else if (td1 === 'bearish' && th4 === 'bullish') {
    direction = 'WAIT'; confidence = 'low';
    narrative = '1D 為空頭大方向，但 4H 正在反彈，不宜追空。等待 4H 反彈結束並出現結構翻空訊號後再進場。';
    waitReason = '等待 4H 結構翻空';
  } else {
    direction = 'WAIT'; confidence = 'low';
    narrative = '各框架趨勢方向不一致或尚未確立，建議暫時觀望，等待訊號明確後再操作。';
    waitReason = '框架訊號不一致';
  }

  let setup = null;
  if (direction === 'LONG') {
    const obs = h4.orderBlocks.bullishOBs.filter(o => o.active);
    if (obs.length) {
      const ob    = obs[obs.length - 1];
      const entry = ob.high, sl = ob.low * 0.998;
      const nextH4H = h4.swings.highs.filter(h => h.price > price);
      const tp1 = nextH4H.length ? nextH4H[nextH4H.length - 1].price : entry * 1.03;
      const d1EQH = d1.equalLevels.eqHighs.filter(e => e.price > price);
      const d1H   = d1.swings.highs.filter(h => h.price > price);
      const tp2   = d1EQH.length ? d1EQH[d1EQH.length-1].price : d1H.length ? d1H[d1H.length-1].price : entry * 1.06;
      const risk  = Math.max(entry - sl, 0.01);
      setup = { entry, sl, tp1, tp2, rr1: ((tp1-entry)/risk).toFixed(1), rr2: ((tp2-entry)/risk).toFixed(1),
        entryNote: price > entry ? '⚠️ 現價高於 OB，等待回踩進場' : '✅ 等待回踩進入 OB 區間' };
    }
  } else if (direction === 'SHORT') {
    const obs = h4.orderBlocks.bearishOBs.filter(o => o.active);
    if (obs.length) {
      const ob    = obs[obs.length - 1];
      const entry = ob.low, sl = ob.high * 1.002;
      const nextH4L = h4.swings.lows.filter(l => l.price < price);
      const tp1 = nextH4L.length ? nextH4L[nextH4L.length-1].price : entry * 0.97;
      const d1EQL = d1.equalLevels.eqLows.filter(e => e.price < price);
      const d1L   = d1.swings.lows.filter(l => l.price < price);
      const tp2   = d1EQL.length ? d1EQL[0].price : d1L.length ? d1L[0].price : entry * 0.94;
      const risk  = Math.max(sl - entry, 0.01);
      setup = { entry, sl, tp1, tp2, rr1: ((entry-tp1)/risk).toFixed(1), rr2: ((entry-tp2)/risk).toFixed(1),
        entryNote: price < entry ? '⚠️ 現價低於 OB，等待反彈進場' : '✅ 等待反彈進入 OB 區間' };
    }
  }

  const h1Rev = [...h1.structure.events].reverse();
  const latestChoch = h1Rev.find(e => e.type === 'CHoCH');

  return {
    trends, direction, confidence, narrative, waitReason, setup, latestChoch, price,
    d1Data: {
      eqHighs: d1.equalLevels.eqHighs.slice(-2), eqLows: d1.equalLevels.eqLows.slice(-2),
      bullOBs: d1.orderBlocks.bullishOBs.filter(o => o.active).slice(-1),
      bearOBs: d1.orderBlocks.bearishOBs.filter(o => o.active).slice(-1),
      events:  d1.structure.events.slice(-3).reverse(),
    },
    h4Data: {
      bullOBs: h4.orderBlocks.bullishOBs.filter(o => o.active).slice(-2),
      bearOBs: h4.orderBlocks.bearishOBs.filter(o => o.active).slice(-2),
      eqHighs: h4.equalLevels.eqHighs.slice(-1), eqLows: h4.equalLevels.eqLows.slice(-1),
      events:  h4.structure.events.slice(-3).reverse(),
    },
    h1Data: { events: h1.structure.events.slice(-5).reverse() },
  };
}

// ══════════════════════════════════════════════════════════════════
//  PANEL RENDER
// ══════════════════════════════════════════════════════════════════
const TREND_MAP = { bullish: ['多頭 ↑','#26a69a'], bearish: ['空頭 ↓','#ef5350'], neutral: ['中性 →','#9b9ea8'] };

function badge(trend) {
  const [l, c] = TREND_MAP[trend] || ['—','#555'];
  return `<span class="mini-badge" style="background:${c}">${l}</span>`;
}

function ri(tag, color, val, dim = '') {
  return `<div class="row-item">
    <span style="color:${color};font-weight:600;min-width:72px;flex-shrink:0">${tag}</span>
    <span>${val}</span>
    ${dim ? `<span class="dim">${dim}</span>` : ''}
  </div>`;
}

function renderMTFPanel(report) {
  latestReport = report;
  const { trends, direction, confidence, narrative, waitReason, setup, latestChoch, d1Data, h4Data, h1Data, price } = report;

  document.getElementById('current-price').textContent = `$${fmt(price)}`;
  document.getElementById('trend-d1').innerHTML = badge(trends.d1);
  document.getElementById('trend-h4').innerHTML = badge(trends.h4);
  document.getElementById('trend-h1').innerHTML = badge(trends.h1);

  // 1D
  const d1El = document.getElementById('d1-content');
  const d1Items = [
    ...d1Data.events.slice(0,2).map(e => {
      const c = e.type==='CHoCH'?'#f39c12':e.direction==='bullish'?'#26a69a':'#ef5350';
      return ri(e.type+(e.direction==='bullish'?' ↑':' ↓'), c, `$${fmt(e.price)}`, fmtDate(e.time));
    }),
    ...d1Data.bullOBs.map(o => ri('Bull OB', '#26a69a', `$${fmt(o.low)} – $${fmt(o.high)}`)),
    ...d1Data.bearOBs.map(o => ri('Bear OB', '#ef5350', `$${fmt(o.low)} – $${fmt(o.high)}`)),
    ...d1Data.eqHighs.map(e => ri('EQH', '#f1c40f', `$${fmt(e.price)}`)),
    ...d1Data.eqLows .map(e => ri('EQL', '#f1c40f', `$${fmt(e.price)}`)),
  ];
  d1El.innerHTML = d1Items.join('') || '<div class="empty">無資料</div>';

  // 4H
  const h4El = document.getElementById('h4-content');
  const h4Items = [
    ...h4Data.events.slice(0,2).map(e => {
      const c = e.type==='CHoCH'?'#f39c12':e.direction==='bullish'?'#26a69a':'#ef5350';
      return ri(e.type+(e.direction==='bullish'?' ↑':' ↓'), c, `$${fmt(e.price)}`, fmtDate(e.time));
    }),
    ...h4Data.bullOBs.map(o => ri('Bull OB ★', '#26a69a', `$${fmt(o.low)} – $${fmt(o.high)}`)),
    ...h4Data.bearOBs.map(o => ri('Bear OB ★', '#ef5350', `$${fmt(o.low)} – $${fmt(o.high)}`)),
    ...h4Data.eqHighs.map(e => ri('EQH', '#f1c40f', `$${fmt(e.price)}`)),
    ...h4Data.eqLows .map(e => ri('EQL', '#f1c40f', `$${fmt(e.price)}`)),
  ];
  h4El.innerHTML = h4Items.join('') || '<div class="empty">無資料</div>';

  // 1H
  const h1El = document.getElementById('h1-content');
  h1El.innerHTML = h1Data.events.slice(0,5).map(e => {
    const c = e.type==='CHoCH'?'#f39c12':e.direction==='bullish'?'#26a69a':'#ef5350';
    return ri(e.type+(e.direction==='bullish'?' ↑':' ↓'), c, `$${fmt(e.price)}`, fmtDate(e.time));
  }).join('') || '<div class="empty">無近期事件</div>';

  // Recommendation
  const recEl = document.getElementById('recommendation');
  const DC = { LONG:['做多 ↑','#26a69a'], SHORT:['做空 ↓','#ef5350'], WAIT:['觀望 ◐','#f39c12'] };
  const CL = { high: '高 ●●●', medium: '中 ●●○', low: '低 ●○○' };
  const [dl, dc] = DC[direction] || DC.WAIT;

  let html = `
    <div class="rec-dir" style="background:${dc}20;border:1px solid ${dc};color:${dc}">${dl}</div>
    <div class="rec-narrative">${narrative}</div>`;

  if (latestChoch) {
    const lcc = latestChoch.direction === 'bullish' ? '#26a69a' : '#ef5350';
    const lcl = latestChoch.direction === 'bullish' ? '已翻多 ✓' : '已翻空 ✓';
    html += ri('1H CHoCH', lcc, lcl, fmtDate(latestChoch.time));
  } else if (waitReason) {
    html += ri('待確認', '#f39c12', waitReason);
  }

  if (setup) {
    const isL = direction === 'LONG';
    const pp  = (a, b) => isL ? `+${pct(a,b)}%` : `${pct(a,b)}%`;
    html += `
      <div class="divider"></div>
      <div class="setup-rows">
        <div class="setup-row"><span>信心程度</span><span>${CL[confidence]}</span></div>
        <div class="setup-row"><span>進場區間</span><span style="color:#3498db">$${fmt(setup.entry)}</span></div>
        <div class="setup-row"><span>止損 SL</span><span style="color:#ef5350">$${fmt(setup.sl)} <em>(${pct(setup.entry,setup.sl)}%)</em></span></div>
        <div class="setup-row"><span>止盈 TP1</span><span style="color:#2ecc71">$${fmt(setup.tp1)} <em>(${pp(setup.entry,setup.tp1)})</em></span></div>
        <div class="setup-row"><span>止盈 TP2</span><span style="color:#27ae60">$${fmt(setup.tp2)} <em>(${pp(setup.entry,setup.tp2)})</em></span></div>
        <div class="setup-row"><span>風險報酬</span><span>TP1 1:${setup.rr1} | TP2 1:${setup.rr2}</span></div>
      </div>
      <div class="rec-note">${setup.entryNote}</div>`;
  }

  // Record button
  if (direction !== 'WAIT' && setup) {
    html += `<button id="record-btn" onclick="recordTrade()">📝 記錄此策略到模擬倉</button>`;
  }

  recEl.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════
//  FORMATTING
// ══════════════════════════════════════════════════════════════════
function fmt(p) {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(4);
  return p.toFixed(6);
}
function pct(a, b) { return ((b - a) / a * 100).toFixed(2); }
function fmtDate(s) {
  return new Date(s * 1000).toLocaleString('zh-TW', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ══════════════════════════════════════════════════════════════════
//  MAIN LOAD & ANALYZE
// ══════════════════════════════════════════════════════════════════
async function loadAndAnalyze() {
  const btn    = document.getElementById('refresh-btn');
  const status = document.getElementById('status');
  btn.disabled = true; btn.textContent = '分析中…';
  status.textContent = '正在抓取 1D / 4H / 1H…'; status.style.color = '#9b9ea8';

  try {
    const mtfTFs   = ['1d','4h','1h'];
    const needExtra = !mtfTFs.includes(currentInterval);
    const promises  = [
      fetchKlines(currentSymbol, '1d', 200),
      fetchKlines(currentSymbol, '4h', 300),
      fetchKlines(currentSymbol, '1h', 300),
    ];
    if (needExtra) promises.push(fetchKlines(currentSymbol, currentInterval, 300));

    const [barsD1, barsH4, barsH1, extraBars] = await Promise.all(promises);

    const chartBars =
      currentInterval === '1d' ? barsD1 :
      currentInterval === '4h' ? barsH4 :
      currentInterval === '1h' ? barsH1 : extraBars;

    candleSeries.setData(chartBars.map(b => ({ time:b.time, open:b.open, high:b.high, low:b.low, close:b.close })));
    volSeries.setData(chartBars.map(b => ({ time:b.time, value:b.volume,
      color: b.close >= b.open ? '#26a69a44' : '#ef535044' })));
    chart.timeScale().fitContent();

    const d1 = analyzeSMC(barsD1, 3);
    const h4 = analyzeSMC(barsH4, 3);
    const h1 = analyzeSMC(barsH1, 3);
    const report = buildMTFReport(d1, h4, h1);

    const chartAnalysis = analyzeSMC(chartBars, 3);
    renderChartOverlays(chartAnalysis, report.setup);
    renderMTFPanel(report);

    const last = chartBars[chartBars.length - 1];
    status.textContent = `更新：${new Date(last.time * 1000).toLocaleString('zh-TW')}`;
    status.style.color = '#26a69a';

  } catch (err) {
    status.textContent = `錯誤：${err.message}`;
    status.style.color = '#ef5350';
    console.error(err);
  } finally {
    btn.disabled = false; btn.textContent = '🔄 刷新';
  }
}

// ══════════════════════════════════════════════════════════════════
//  SECTION TOGGLE
// ══════════════════════════════════════════════════════════════════
function toggleSec(id) {
  const body   = document.getElementById(id);
  const toggle = document.getElementById('toggle-' + id);
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  if (toggle) toggle.textContent = collapsed ? '▼' : '▲';
}
function expandSec(id) {
  const body   = document.getElementById(id);
  const toggle = document.getElementById('toggle-' + id);
  if (!body || !body.classList.contains('collapsed')) return;
  body.classList.remove('collapsed');
  if (toggle) toggle.textContent = '▲';
}

// ══════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  initChart();

  // ── Sheets URL 輸入框 ──
  const sheetsInput = document.getElementById('sheets-url-input');
  if (sheetsInput) {
    sheetsInput.value = getSheetsUrl();
    sheetsInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') setSheetsUrl(e.target.value);
    });
  }
  document.getElementById('sheets-connect-btn')?.addEventListener('click', () => {
    setSheetsUrl(sheetsInput?.value || '');
  });
  document.getElementById('sheets-clear-btn')?.addEventListener('click', () => {
    if (sheetsInput) sheetsInput.value = '';
    setSheetsUrl('');
    updateSheetsStatus('none');
  });

  // ── 初始化快取（從 Sheets 或 localStorage）──
  updateSheetsStatus(getSheetsUrl() ? 'connecting' : 'none');
  await initTradesCache();
  updateSheetsStatus(getSheetsUrl() ? 'ok' : 'none');
  renderTradeLog();

  const symbolInput = document.getElementById('symbol-input');
  symbolInput.value = currentSymbol;

  symbolInput.addEventListener('keypress', e => {
    if (e.key !== 'Enter') return;
    currentSymbol = e.target.value.trim().toUpperCase();
    document.querySelectorAll('.sym-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('price-symbol').textContent = currentSymbol;
    loadAndAnalyze();
  });

  document.querySelectorAll('.sym-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSymbol = btn.dataset.symbol;
      symbolInput.value = currentSymbol;
      document.querySelectorAll('.sym-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('price-symbol').textContent = currentSymbol;
      loadAndAnalyze();
    });
  });

  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentInterval = btn.dataset.interval;
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('chart-tf-label').textContent = btn.textContent;
      loadAndAnalyze();
    });
  });

  document.getElementById('refresh-btn').addEventListener('click', loadAndAnalyze);

  if (loadTrades().some(t => t.status === 'open')) startPolling();

  loadAndAnalyze();
});
