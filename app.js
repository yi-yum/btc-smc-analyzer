// app.js — Multi-Timeframe SMC Dashboard

const BINANCE_API = 'https://api.binance.com/api/v3/klines';

let chart        = null;
let candleSeries = null;
let volSeries    = null;
let activePriceLines = [];

let currentSymbol   = 'BTCUSDT';
let currentInterval = '4h';   // chart display TF

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

// ─── Overlay helpers ──────────────────────────────────────────────────────────
function clearOverlays() {
  activePriceLines.forEach(({ series, line }) => {
    try { series.removePriceLine(line); } catch (_) {}
  });
  activePriceLines = [];
  candleSeries.setMarkers([]);
}

function addPriceLine(opts) {
  const line = candleSeries.createPriceLine(opts);
  activePriceLines.push({ series: candleSeries, line });
}

// ─── Render chart SMC overlays (based on selected chart TF) ──────────────────
function renderChartOverlays(analysis) {
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

  // Order Blocks
  orderBlocks.bullishOBs.filter(ob => ob.active).slice(-3).forEach(ob => {
    addPriceLine({ price: ob.high, color: '#26a69a', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true,  title: '🟢 OB' });
    addPriceLine({ price: ob.low,  color: '#26a69a', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });
  orderBlocks.bearishOBs.filter(ob => ob.active).slice(-3).forEach(ob => {
    addPriceLine({ price: ob.low,  color: '#ef5350', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true,  title: '🔴 OB' });
    addPriceLine({ price: ob.high, color: '#ef5350', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });

  // Equal Highs / Lows
  equalLevels.eqHighs.slice(-2).forEach(e =>
    addPriceLine({ price: e.price, color: '#f1c40f', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true, title: 'EQH' }));
  equalLevels.eqLows.slice(-2).forEach(e =>
    addPriceLine({ price: e.price, color: '#f1c40f', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true, title: 'EQL' }));

  // FVGs
  fvgs.bullish.filter(f => f.active).slice(-2).forEach(f => {
    addPriceLine({ price: f.top,    color: '#1abc9c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true,  title: 'FVG↑' });
    addPriceLine({ price: f.bottom, color: '#1abc9c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });
  fvgs.bearish.filter(f => f.active).slice(-2).forEach(f => {
    addPriceLine({ price: f.bottom, color: '#e74c3c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: true,  title: 'FVG↓' });
    addPriceLine({ price: f.top,    color: '#e74c3c', lineWidth: 1, lineStyle: LS.Dotted, axisLabelVisible: false, title: '' });
  });

  // Trade setup lines (from MTF recommendation)
  if (tradeSetup) {
    const { entry, sl, tp1, tp2 } = tradeSetup;
    addPriceLine({ price: entry, color: '#3498db', lineWidth: 2, lineStyle: LS.Solid,  axisLabelVisible: true, title: '📍 Entry' });
    addPriceLine({ price: sl,    color: '#e74c3c', lineWidth: 2, lineStyle: LS.Solid,  axisLabelVisible: true, title: '🛑 SL' });
    addPriceLine({ price: tp1,   color: '#2ecc71', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true, title: '🎯 TP1' });
    addPriceLine({ price: tp2,   color: '#27ae60', lineWidth: 1, lineStyle: LS.Dashed, axisLabelVisible: true, title: '🎯 TP2' });
  }
}

// ─── MTF Report Builder ───────────────────────────────────────────────────────
function buildMTFReport(d1, h4, h1) {
  const trends = {
    d1: d1.structure.trend,
    h4: h4.structure.trend,
    h1: h1.structure.trend,
  };

  const price = h1.bars[h1.bars.length - 1].close;

  // ── Determine direction & confidence ──
  let direction, confidence, narrative, waitReason = '';

  const { d1: td1, h4: th4, h1: th1 } = trends;

  if (td1 === 'bullish' && th4 === 'bullish' && th1 === 'bullish') {
    direction = 'LONG'; confidence = 'high';
    narrative = '三框架多頭完全對齊。1D 確立大方向，4H 結構向上，1H 已翻多確認入場時機，可在 4H OB 回踩時積極進場。';
  } else if (td1 === 'bullish' && th4 === 'bullish' && th1 !== 'bullish') {
    direction = 'LONG'; confidence = 'medium';
    narrative = '1D 與 4H 均為多頭，大方向看漲。但 1H 尚未出現 CHoCH 翻多，建議等待 1H 結構確認後再進場，可降低被掃損風險。';
    waitReason = '等待 1H CHoCH 翻多';
  } else if (td1 === 'bullish' && th4 === 'bearish') {
    direction = 'WAIT'; confidence = 'low';
    narrative = '1D 為多頭大方向，但 4H 正在回踩調整，目前做多風險偏高。等待 4H 形成較低點後出現 BOS 確認反轉，才是較安全的進場時機。';
    waitReason = '等待 4H 結構翻多';
  } else if (td1 === 'bullish' && th4 === 'neutral') {
    direction = 'WAIT'; confidence = 'low';
    narrative = '1D 多頭，4H 結構尚不明確，建議觀望等待 4H 方向確立。';
    waitReason = '等待 4H 方向明確';
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

  // ── Build setup from 4H OB (aligned with MTF direction) ──
  let setup = null;

  if (direction === 'LONG') {
    const obs = h4.orderBlocks.bullishOBs.filter(ob => ob.active);
    if (obs.length) {
      const ob  = obs[obs.length - 1];
      const entry = ob.high;
      const sl    = ob.low * 0.998;

      // TP1: nearest 4H swing high above price
      const nextH4Highs = h4.swings.highs.filter(h => h.price > price);
      const tp1 = nextH4Highs.length ? nextH4Highs[nextH4Highs.length - 1].price : entry * 1.03;

      // TP2: 1D EQH or 1D swing high
      const d1EQH   = d1.equalLevels.eqHighs.filter(e => e.price > price);
      const d1Highs = d1.swings.highs.filter(h => h.price > price);
      const tp2 = d1EQH.length   ? d1EQH[d1EQH.length - 1].price
                : d1Highs.length ? d1Highs[d1Highs.length - 1].price
                : entry * 1.06;

      const risk = Math.max(entry - sl, 0.01);
      setup = {
        entry, sl, tp1, tp2,
        rr1: ((tp1 - entry) / risk).toFixed(1),
        rr2: ((tp2 - entry) / risk).toFixed(1),
        entryNote: price > entry ? '⚠️ 現價高於 OB，等待回踩進場' : '✅ 等待回踩進入 OB 區間',
        ob,
      };
    }
  } else if (direction === 'SHORT') {
    const obs = h4.orderBlocks.bearishOBs.filter(ob => ob.active);
    if (obs.length) {
      const ob    = obs[obs.length - 1];
      const entry = ob.low;
      const sl    = ob.high * 1.002;

      const nextH4Lows = h4.swings.lows.filter(l => l.price < price);
      const tp1 = nextH4Lows.length ? nextH4Lows[nextH4Lows.length - 1].price : entry * 0.97;

      const d1EQL  = d1.equalLevels.eqLows.filter(e => e.price < price);
      const d1Lows = d1.swings.lows.filter(l => l.price < price);
      const tp2 = d1EQL.length  ? d1EQL[0].price
                : d1Lows.length ? d1Lows[0].price
                : entry * 0.94;

      const risk = Math.max(sl - entry, 0.01);
      setup = {
        entry, sl, tp1, tp2,
        rr1: ((entry - tp1) / risk).toFixed(1),
        rr2: ((entry - tp2) / risk).toFixed(1),
        entryNote: price < entry ? '⚠️ 現價低於 OB，等待反彈進場' : '✅ 等待反彈進入 OB 區間',
        ob,
      };
    }
  }

  // ── 1H CHoCH check ──
  const h1EventsRev = [...h1.structure.events].reverse();
  const latestChoch = h1EventsRev.find(e => e.type === 'CHoCH');

  return {
    trends, direction, confidence, narrative, waitReason, setup, latestChoch, price,
    d1Data: {
      trend:    td1,
      eqHighs:  d1.equalLevels.eqHighs.slice(-2),
      eqLows:   d1.equalLevels.eqLows.slice(-2),
      bullOBs:  d1.orderBlocks.bullishOBs.filter(ob => ob.active).slice(-1),
      bearOBs:  d1.orderBlocks.bearishOBs.filter(ob => ob.active).slice(-1),
      events:   d1.structure.events.slice(-3).reverse(),
    },
    h4Data: {
      trend:   th4,
      bullOBs: h4.orderBlocks.bullishOBs.filter(ob => ob.active).slice(-2),
      bearOBs: h4.orderBlocks.bearishOBs.filter(ob => ob.active).slice(-2),
      eqHighs: h4.equalLevels.eqHighs.slice(-1),
      eqLows:  h4.equalLevels.eqLows.slice(-1),
      events:  h4.structure.events.slice(-3).reverse(),
    },
    h1Data: {
      trend:  th1,
      events: h1.structure.events.slice(-5).reverse(),
    },
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmt(p) {
  if (!p && p !== 0) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(4);
  return p.toFixed(6);
}

function pct(from, to) { return ((to - from) / from * 100).toFixed(2); }

function fmtDate(unixSec) {
  return new Date(unixSec * 1000).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const TREND_LABEL = { bullish: '多頭 ↑', bearish: '空頭 ↓', neutral: '中性 →' };
const TREND_COLOR = { bullish: '#26a69a', bearish: '#ef5350', neutral: '#9b9ea8' };

function trendBadgeHTML(trend) {
  const c = TREND_COLOR[trend] || '#9b9ea8';
  const l = TREND_LABEL[trend] || '—';
  return `<span class="mini-badge" style="background:${c}">${l}</span>`;
}

function rowItemHTML(tag, color, value, dim = '') {
  return `<div class="row-item">
    <span style="color:${color};font-weight:600;min-width:68px;flex-shrink:0">${tag}</span>
    <span>${value}</span>
    ${dim ? `<span class="dim">${dim}</span>` : ''}
  </div>`;
}

// ─── Render MTF Panel ─────────────────────────────────────────────────────────
function renderMTFPanel(report) {
  const {
    trends, direction, confidence, narrative, waitReason,
    setup, latestChoch, price,
    d1Data, h4Data, h1Data,
  } = report;

  // ── Current price ──
  document.getElementById('current-price').textContent = `$${fmt(price)}`;

  // ── Trend badges ──
  document.getElementById('trend-d1').innerHTML = trendBadgeHTML(trends.d1);
  document.getElementById('trend-h4').innerHTML = trendBadgeHTML(trends.h4);
  document.getElementById('trend-h1').innerHTML = trendBadgeHTML(trends.h1);

  // ── 1D Section ──
  const d1El = document.getElementById('d1-content');
  const d1Items = [
    ...d1Data.events.slice(0, 2).map(e => {
      const c = e.type === 'CHoCH' ? '#f39c12' : (e.direction === 'bullish' ? '#26a69a' : '#ef5350');
      return rowItemHTML(e.type + (e.direction === 'bullish' ? ' ↑' : ' ↓'), c, `$${fmt(e.price)}`, fmtDate(e.time));
    }),
    ...d1Data.bullOBs.map(ob => rowItemHTML('Bull OB', '#26a69a', `$${fmt(ob.low)} – $${fmt(ob.high)}`)),
    ...d1Data.bearOBs.map(ob => rowItemHTML('Bear OB', '#ef5350', `$${fmt(ob.low)} – $${fmt(ob.high)}`)),
    ...d1Data.eqHighs.map(e  => rowItemHTML('EQH', '#f1c40f', `$${fmt(e.price)}`)),
    ...d1Data.eqLows .map(e  => rowItemHTML('EQL', '#f1c40f', `$${fmt(e.price)}`)),
  ];
  d1El.innerHTML = d1Items.length ? d1Items.join('') : '<div class="empty">無資料</div>';

  // ── 4H Section ──
  const h4El = document.getElementById('h4-content');
  const h4Items = [
    ...h4Data.events.slice(0, 2).map(e => {
      const c = e.type === 'CHoCH' ? '#f39c12' : (e.direction === 'bullish' ? '#26a69a' : '#ef5350');
      return rowItemHTML(e.type + (e.direction === 'bullish' ? ' ↑' : ' ↓'), c, `$${fmt(e.price)}`, fmtDate(e.time));
    }),
    ...h4Data.bullOBs.map(ob => rowItemHTML('Bull OB ★', '#26a69a', `$${fmt(ob.low)} – $${fmt(ob.high)}`)),
    ...h4Data.bearOBs.map(ob => rowItemHTML('Bear OB ★', '#ef5350', `$${fmt(ob.low)} – $${fmt(ob.high)}`)),
    ...h4Data.eqHighs.map(e  => rowItemHTML('EQH', '#f1c40f', `$${fmt(e.price)}`)),
    ...h4Data.eqLows .map(e  => rowItemHTML('EQL', '#f1c40f', `$${fmt(e.price)}`)),
  ];
  h4El.innerHTML = h4Items.length ? h4Items.join('') : '<div class="empty">無資料</div>';

  // ── 1H Section ──
  const h1El = document.getElementById('h1-content');
  const h1Items = h1Data.events.slice(0, 5).map(e => {
    const c = e.type === 'CHoCH' ? '#f39c12' : (e.direction === 'bullish' ? '#26a69a' : '#ef5350');
    return rowItemHTML(e.type + (e.direction === 'bullish' ? ' ↑' : ' ↓'), c, `$${fmt(e.price)}`, fmtDate(e.time));
  });
  h1El.innerHTML = h1Items.length ? h1Items.join('') : '<div class="empty">無近期事件</div>';

  // ── Recommendation ──
  const recEl = document.getElementById('recommendation');

  const dirConfig = {
    LONG:  { label: '做多 ↑', color: '#26a69a' },
    SHORT: { label: '做空 ↓', color: '#ef5350' },
    WAIT:  { label: '觀望 ◐', color: '#f39c12' },
  };
  const confLabel = { high: '高 ●●●', medium: '中 ●●○', low: '低 ●○○' };

  const dc = dirConfig[direction] || dirConfig.WAIT;

  let html = `
    <div class="rec-dir" style="background:${dc.color}20;border:1px solid ${dc.color};color:${dc.color}">
      ${dc.label}
    </div>
    <div class="rec-narrative">${narrative}</div>`;

  // 1H CHoCH status
  if (latestChoch) {
    const lc  = latestChoch;
    const lcc = lc.direction === 'bullish' ? '#26a69a' : '#ef5350';
    const lcl = lc.direction === 'bullish' ? '已翻多 ✓' : '已翻空 ✓';
    html += rowItemHTML('1H CHoCH', lcc, lcl, fmtDate(lc.time));
  } else if (waitReason) {
    html += `<div class="row-item"><span style="color:#f39c12;font-weight:600">待確認</span><span>${waitReason}</span></div>`;
  }

  // Setup table
  if (setup) {
    const isLong = direction === 'LONG';
    const pctFn  = (a, b) => isLong ? `+${pct(a, b)}%` : `${pct(a, b)}%`;
    html += `
      <div class="divider"></div>
      <div class="setup-rows">
        <div class="setup-row"><span>信心程度</span><span>${confLabel[confidence]}</span></div>
        <div class="setup-row"><span>進場區間</span><span style="color:#3498db">$${fmt(setup.entry)}</span></div>
        <div class="setup-row"><span>止損 SL</span><span style="color:#ef5350">$${fmt(setup.sl)} <em>(${pct(setup.entry, setup.sl)}%)</em></span></div>
        <div class="setup-row"><span>止盈 TP1</span><span style="color:#2ecc71">$${fmt(setup.tp1)} <em>(${pctFn(setup.entry, setup.tp1)})</em></span></div>
        <div class="setup-row"><span>止盈 TP2</span><span style="color:#27ae60">$${fmt(setup.tp2)} <em>(${pctFn(setup.entry, setup.tp2)})</em></span></div>
        <div class="setup-row"><span>風險報酬</span><span>TP1&nbsp;1:${setup.rr1}&nbsp;|&nbsp;TP2&nbsp;1:${setup.rr2}</span></div>
      </div>
      <div class="rec-note">${setup.entryNote}</div>`;
  } else if (direction !== 'WAIT') {
    html += `<div class="empty" style="margin-top:6px">無可用 4H Order Block 計算進場點</div>`;
  }

  recEl.innerHTML = html;
}

// ─── Main Load & Analyze ──────────────────────────────────────────────────────
async function loadAndAnalyze() {
  const btn    = document.getElementById('refresh-btn');
  const status = document.getElementById('status');

  btn.disabled    = true;
  btn.textContent = '分析中…';
  status.textContent = '正在抓取 1D / 4H / 1H 資料…';
  status.style.color = '#9b9ea8';

  try {
    // Always fetch 1D, 4H, 1H for analysis
    // Also fetch the chart TF if different
    const mtfTFs = ['1d', '4h', '1h'];
    const needExtra = !mtfTFs.includes(currentInterval);

    const promises = [
      fetchKlines(currentSymbol, '1d', 200),
      fetchKlines(currentSymbol, '4h', 300),
      fetchKlines(currentSymbol, '1h', 300),
    ];
    if (needExtra) promises.push(fetchKlines(currentSymbol, currentInterval, 300));

    const [barsD1, barsH4, barsH1, extraBars] = await Promise.all(promises);

    // Chart bars = selected TF
    const chartBars =
      currentInterval === '1d' ? barsD1 :
      currentInterval === '4h' ? barsH4 :
      currentInterval === '1h' ? barsH1 : extraBars;

    // Update chart
    candleSeries.setData(chartBars.map(b => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    })));
    volSeries.setData(chartBars.map(b => ({
      time: b.time, value: b.volume,
      color: b.close >= b.open ? '#26a69a44' : '#ef535044',
    })));
    chart.timeScale().fitContent();

    // SMC analysis per TF
    const d1 = analyzeSMC(barsD1, 3);
    const h4 = analyzeSMC(barsH4, 3);
    const h1 = analyzeSMC(barsH1, 3);

    // MTF report
    const report = buildMTFReport(d1, h4, h1);

    // Chart overlays based on chart TF analysis
    const chartAnalysis = analyzeSMC(chartBars, 3);
    // Inject MTF setup lines into chart overlays
    chartAnalysis.tradeSetup = report.setup;
    renderChartOverlays(chartAnalysis);

    // Render panel
    renderMTFPanel(report);

    const lastBar = chartBars[chartBars.length - 1];
    status.textContent = `更新：${new Date(lastBar.time * 1000).toLocaleString('zh-TW')}`;
    status.style.color = '#26a69a';

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

  symbolInput.addEventListener('keypress', e => {
    if (e.key !== 'Enter') return;
    currentSymbol = symbolInput.value.trim().toUpperCase();
    document.querySelectorAll('.sym-btn').forEach(b => b.classList.remove('active'));
    loadAndAnalyze();
  });

  document.querySelectorAll('.sym-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSymbol = btn.dataset.symbol;
      symbolInput.value = currentSymbol;
      document.querySelectorAll('.sym-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadAndAnalyze();
    });
  });

  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentInterval = btn.dataset.interval;
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadAndAnalyze();
    });
  });

  document.getElementById('refresh-btn').addEventListener('click', loadAndAnalyze);

  loadAndAnalyze();
});
