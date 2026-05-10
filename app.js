// app.js — Chart + Binance API + UI Logic

const BINANCE_API = 'https://api.binance.com/api/v3/klines';

let chart        = null;
let candleSeries = null;
let volSeries    = null;
let activePriceLines = [];

let currentSymbol   = 'BTCUSDT';
let currentInterval = '4h';

// ─── Fetch ────────────────────────────────────────────────────────────────────
async function fetchKlines(symbol, interval, limit = 300) {
  const url = `${BINANCE_API}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || `HTTP ${res.status}`);
  }
  return parseBinanceKlines(await res.json());
}

// ─── Chart Init ───────────────────────────────────────────────────────────────
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
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
  });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

  window.addEventListener('resize', () => {
    chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
  });
}

// ─── Overlay Management ───────────────────────────────────────────────────────
function clearOverlays() {
  activePriceLines.forEach(({ series, line }) => {
    try { series.removePriceLine(line); } catch (_) {}
  });
  activePriceLines = [];
  candleSeries.setMarkers([]);
}

function addPriceLine(series, opts) {
  const line = series.createPriceLine(opts);
  activePriceLines.push({ series, line });
  return line;
}

// ─── Render SMC Overlays on Chart ────────────────────────────────────────────
function renderSMCOverlays(analysis) {
  clearOverlays();
  const { structure, orderBlocks, fvgs, equalLevels, tradeSetup } = analysis;
  const LS = LightweightCharts.LineStyle;

  // BOS / CHoCH markers
  const markers = structure.events.slice(-15).map(e => ({
    time:     e.time,
    position: e.direction === 'bullish' ? 'belowBar' : 'aboveBar',
    color:    e.type === 'CHoCH' ? '#f39c12' : (e.direction === 'bullish' ? '#26a69a' : '#ef5350'),
    shape:    e.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
    text:     e.type,
    size:     1,
  }));
  candleSeries.setMarkers(markers.sort((a, b) => a.time - b.time));

  // Bullish Order Blocks
  orderBlocks.bullishOBs.filter(ob => ob.active).slice(-3).forEach(ob => {
    addPriceLine(candleSeries, { price: ob.high, color: '#26a69a', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true,  title: '🟢 OB Top' });
    addPriceLine(candleSeries, { price: ob.low,  color: '#26a69a', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });

  // Bearish Order Blocks
  orderBlocks.bearishOBs.filter(ob => ob.active).slice(-3).forEach(ob => {
    addPriceLine(candleSeries, { price: ob.high, color: '#ef5350', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
    addPriceLine(candleSeries, { price: ob.low,  color: '#ef5350', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true,  title: '🔴 OB Bot' });
  });

  // Equal Highs / Lows
  equalLevels.eqHighs.slice(-2).forEach(e => {
    addPriceLine(candleSeries, { price: e.price, color: '#f1c40f', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true, title: 'EQH' });
  });
  equalLevels.eqLows.slice(-2).forEach(e => {
    addPriceLine(candleSeries, { price: e.price, color: '#f1c40f', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true, title: 'EQL' });
  });

  // FVGs (active only, most recent 2)
  fvgs.bullish.filter(f => f.active).slice(-2).forEach(f => {
    addPriceLine(candleSeries, { price: f.top,    color: '#1abc9c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true,  title: 'FVG↑' });
    addPriceLine(candleSeries, { price: f.bottom, color: '#1abc9c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });
  fvgs.bearish.filter(f => f.active).slice(-2).forEach(f => {
    addPriceLine(candleSeries, { price: f.top,    color: '#e74c3c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
    addPriceLine(candleSeries, { price: f.bottom, color: '#e74c3c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true,  title: 'FVG↓' });
  });

  // Trade Setup Lines
  if (tradeSetup) {
    const { entry, sl, tp1, tp2 } = tradeSetup;
    addPriceLine(candleSeries, { price: entry, color: '#3498db', lineWidth: 2, lineStyle: LS.Solid,  axisLabelVisible: true, title: '📍 Entry' });
    addPriceLine(candleSeries, { price: sl,    color: '#e74c3c', lineWidth: 2, lineStyle: LS.Solid,  axisLabelVisible: true, title: '🛑 SL' });
    addPriceLine(candleSeries, { price: tp1,   color: '#2ecc71', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true, title: '🎯 TP1' });
    addPriceLine(candleSeries, { price: tp2,   color: '#27ae60', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true, title: '🎯 TP2' });
  }
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────
function fmt(p) {
  if (p >= 1000)  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)     return p.toFixed(4);
  return p.toFixed(6);
}

function pct(from, to) {
  return ((to - from) / from * 100).toFixed(2);
}

function fmtDate(unixSec) {
  return new Date(unixSec * 1000).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Render Analysis Panel ────────────────────────────────────────────────────
function renderPanel(analysis) {
  const { structure, orderBlocks, equalLevels, fvgs, tradeSetup, bars } = analysis;
  const last  = bars[bars.length - 1];
  const price = last.close;

  // Trend badge
  const badge = document.getElementById('trend-badge');
  const trendMap = {
    bullish: { label: '多頭 ↑', color: '#26a69a' },
    bearish: { label: '空頭 ↓', color: '#ef5350' },
    neutral: { label: '中性 →', color: '#9b9ea8' },
  };
  const t = trendMap[structure.trend];
  badge.style.background = t.color;
  badge.textContent = t.label;

  // Current price
  document.getElementById('current-price').textContent = `$${fmt(price)}`;

  // Recent events
  const eventsEl = document.getElementById('recent-events');
  const recent = [...structure.events].reverse().slice(0, 6);
  eventsEl.innerHTML = recent.length
    ? recent.map(e => {
        const color = e.type === 'CHoCH' ? '#f39c12' : (e.direction === 'bullish' ? '#26a69a' : '#ef5350');
        const icon  = e.direction === 'bullish' ? '↑' : '↓';
        return `<div class="row-item">
          <span style="color:${color};font-weight:600;min-width:65px">${e.type} ${icon}</span>
          <span>$${fmt(e.price)}</span>
          <span class="dim">${fmtDate(e.time)}</span>
        </div>`;
      }).join('')
    : '<div class="empty">無結構事件</div>';

  // Key levels
  const levelsEl = document.getElementById('key-levels');
  const levels = [
    ...orderBlocks.bullishOBs.filter(ob => ob.active).slice(-2).map(ob => ({
      tag: `Bull OB${ob.eventType === 'CHoCH' ? ' ★' : ''}`, color: '#26a69a',
      label: `$${fmt(ob.low)} – $${fmt(ob.high)}`,
    })),
    ...orderBlocks.bearishOBs.filter(ob => ob.active).slice(-2).map(ob => ({
      tag: `Bear OB${ob.eventType === 'CHoCH' ? ' ★' : ''}`, color: '#ef5350',
      label: `$${fmt(ob.low)} – $${fmt(ob.high)}`,
    })),
    ...equalLevels.eqHighs.slice(-2).map(e => ({ tag: 'EQH', color: '#f1c40f', label: `$${fmt(e.price)}` })),
    ...equalLevels.eqLows .slice(-2).map(e => ({ tag: 'EQL', color: '#f1c40f', label: `$${fmt(e.price)}` })),
    ...fvgs.bullish.filter(f => f.active).slice(-1).map(f => ({
      tag: 'FVG↑', color: '#1abc9c', label: `$${fmt(f.bottom)} – $${fmt(f.top)}`,
    })),
    ...fvgs.bearish.filter(f => f.active).slice(-1).map(f => ({
      tag: 'FVG↓', color: '#e74c3c', label: `$${fmt(f.bottom)} – $${fmt(f.top)}`,
    })),
  ];
  levelsEl.innerHTML = levels.length
    ? levels.map(l => `<div class="row-item">
        <span style="color:${l.color};font-weight:600;min-width:70px">${l.tag}</span>
        <span>${l.label}</span>
      </div>`).join('')
    : '<div class="empty">無活躍關鍵區域</div>';

  // Trade setup
  const setupEl = document.getElementById('trade-setup');
  if (tradeSetup) {
    const { direction, entry, sl, tp1, tp2, rr1, rr2, note } = tradeSetup;
    const dc = direction === 'LONG' ? '#26a69a' : '#ef5350';
    const di = direction === 'LONG' ? '做多 ↑' : '做空 ↓';
    const pctFn = direction === 'LONG'
      ? (from, to) => `+${pct(from, to)}%`
      : (from, to) => `${pct(from, to)}%`;

    setupEl.innerHTML = `
      <div class="setup-dir" style="background:${dc}20;border:1px solid ${dc};color:${dc}">${di}</div>
      <div class="setup-note">${note}</div>
      <div class="setup-rows">
        <div class="setup-row"><span>進場區間</span><span style="color:#3498db">$${fmt(entry)}</span></div>
        <div class="setup-row"><span>止損 SL</span><span style="color:#ef5350">$${fmt(sl)} <small>(${pct(entry,sl)}%)</small></span></div>
        <div class="setup-row"><span>止盈 TP1</span><span style="color:#2ecc71">$${fmt(tp1)} <small>(${pctFn(entry,tp1)})</small></span></div>
        <div class="setup-row"><span>止盈 TP2</span><span style="color:#27ae60">$${fmt(tp2)} <small>(${pctFn(entry,tp2)})</small></span></div>
        <div class="setup-row"><span>風險報酬</span><span>TP1: 1:${rr1} &nbsp;|&nbsp; TP2: 1:${rr2}</span></div>
      </div>`;
  } else {
    setupEl.innerHTML = '<div class="empty">目前無明確操作訊號</div>';
  }
}

// ─── Main Load & Analyze ──────────────────────────────────────────────────────
async function loadAndAnalyze() {
  const btn    = document.getElementById('refresh-btn');
  const status = document.getElementById('status');

  btn.disabled    = true;
  btn.textContent = '載入中…';
  status.textContent = '';

  try {
    const bars = await fetchKlines(currentSymbol, currentInterval, 300);

    // Chart data
    candleSeries.setData(bars.map(b => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    })));
    volSeries.setData(bars.map(b => ({
      time: b.time, value: b.volume,
      color: b.close >= b.open ? '#26a69a55' : '#ef535055',
    })));
    chart.timeScale().fitContent();

    // Analyse
    const analysis = analyzeSMC(bars, 3);
    renderSMCOverlays(analysis);
    renderPanel(analysis);

    const last = bars[bars.length - 1];
    status.textContent  = `更新：${new Date(last.time * 1000).toLocaleString('zh-TW')}`;
    status.style.color  = '#26a69a';

  } catch (err) {
    status.textContent = `錯誤：${err.message}`;
    status.style.color = '#ef5350';
    console.error(err);
  } finally {
    btn.disabled    = false;
    btn.textContent = '🔄 刷新';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initChart();

  const symbolInput = document.getElementById('symbol-input');
  symbolInput.value = currentSymbol;

  // Enter key on symbol input
  symbolInput.addEventListener('keypress', e => {
    if (e.key !== 'Enter') return;
    currentSymbol = symbolInput.value.trim().toUpperCase();
    document.querySelectorAll('.sym-btn').forEach(b => b.classList.remove('active'));
    loadAndAnalyze();
  });

  // Quick symbol buttons
  document.querySelectorAll('.sym-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSymbol = btn.dataset.symbol;
      symbolInput.value = currentSymbol;
      document.querySelectorAll('.sym-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadAndAnalyze();
    });
  });

  // Timeframe buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentInterval = btn.dataset.interval;
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadAndAnalyze();
    });
  });

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', loadAndAnalyze);

  // Initial load
  loadAndAnalyze();
});
