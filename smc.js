// smc.js — Smart Money Concepts Analysis Engine
// Detects: Swing Highs/Lows, BOS, CHoCH, Order Blocks, FVG, Equal Highs/Lows

function parseBinanceKlines(raw) {
  return raw.map(k => ({
    time:   k[0] / 1000,
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// ─── 1. Swing High / Low Detection ───────────────────────────────────────────
function detectSwings(bars, lookback = 3) {
  const highs = [];
  const lows  = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true, isLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low  <= bars[i].low)  isLow  = false;
    }

    if (isHigh) highs.push({ index: i, price: bars[i].high, time: bars[i].time });
    if (isLow)  lows.push ({ index: i, price: bars[i].low,  time: bars[i].time });
  }

  return { highs, lows };
}

// ─── 2. Market Structure: BOS & CHoCH ────────────────────────────────────────
function analyzeMarketStructure(bars, swings) {
  const events = [];
  let trend = 'neutral';
  let lastHigh = null;
  let lastLow  = null;

  const highMap = {};
  const lowMap  = {};
  swings.highs.forEach(s => highMap[s.index] = s);
  swings.lows .forEach(s => lowMap [s.index] = s);

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];

    // Bullish break of last swing high
    if (lastHigh && bar.close > lastHigh.price) {
      const type = trend === 'bearish' ? 'CHoCH' : 'BOS';
      events.push({ type, direction: 'bullish', index: i, price: lastHigh.price, time: bar.time });
      trend    = 'bullish';
      lastHigh = null;
    }

    // Bearish break of last swing low
    if (lastLow && bar.close < lastLow.price) {
      const type = trend === 'bullish' ? 'CHoCH' : 'BOS';
      events.push({ type, direction: 'bearish', index: i, price: lastLow.price, time: bar.time });
      trend   = 'bearish';
      lastLow = null;
    }

    if (highMap[i]) lastHigh = highMap[i];
    if (lowMap [i]) lastLow  = lowMap [i];
  }

  return { events, trend };
}

// ─── 3. Order Block Detection ─────────────────────────────────────────────────
function detectOrderBlocks(bars, structureEvents) {
  const bullishOBs = [];
  const bearishOBs = [];

  for (const event of structureEvents) {
    // Search up to 10 bars back for the last opposing candle
    const start = Math.max(0, event.index - 10);

    if (event.direction === 'bullish') {
      for (let i = event.index - 1; i >= start; i--) {
        if (bars[i].close < bars[i].open) { // bearish candle → bullish OB
          bullishOBs.push({
            index: i, time: bars[i].time,
            high: bars[i].high, low: bars[i].low,
            eventType: event.type, active: true,
          });
          break;
        }
      }
    } else {
      for (let i = event.index - 1; i >= start; i--) {
        if (bars[i].close > bars[i].open) { // bullish candle → bearish OB
          bearishOBs.push({
            index: i, time: bars[i].time,
            high: bars[i].high, low: bars[i].low,
            eventType: event.type, active: true,
          });
          break;
        }
      }
    }
  }

  // Mark mitigated OBs (price has closed through them)
  const last = bars[bars.length - 1];
  bullishOBs.forEach(ob => { if (last.close < ob.low)  ob.active = false; });
  bearishOBs.forEach(ob => { if (last.close > ob.high) ob.active = false; });

  return { bullishOBs, bearishOBs };
}

// ─── 4. Fair Value Gap (FVG) ──────────────────────────────────────────────────
function detectFVG(bars) {
  const bullish = [];
  const bearish = [];

  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2], c = bars[i];

    if (a.high < c.low)  bullish.push({ top: c.low,  bottom: a.high, time: bars[i-1].time, active: true });
    if (a.low  > c.high) bearish.push({ top: a.low,  bottom: c.high, time: bars[i-1].time, active: true });
  }

  const last = bars[bars.length - 1];
  bullish.forEach(f => { if (last.low  <= f.bottom) f.active = false; });
  bearish.forEach(f => { if (last.high >= f.top)    f.active = false; });

  return { bullish, bearish };
}

// ─── 5. Equal Highs / Equal Lows ─────────────────────────────────────────────
function detectEqualLevels(swings, tol = 0.003) {
  const eqHighs = [];
  const eqLows  = [];

  for (let i = 0; i < swings.highs.length - 1; i++) {
    for (let j = i + 1; j < swings.highs.length; j++) {
      const diff = Math.abs(swings.highs[i].price - swings.highs[j].price) / swings.highs[i].price;
      if (diff <= tol) {
        eqHighs.push({
          price:  (swings.highs[i].price + swings.highs[j].price) / 2,
          index1: swings.highs[i].index, index2: swings.highs[j].index,
          time1:  swings.highs[i].time,  time2:  swings.highs[j].time,
        });
      }
    }
  }

  for (let i = 0; i < swings.lows.length - 1; i++) {
    for (let j = i + 1; j < swings.lows.length; j++) {
      const diff = Math.abs(swings.lows[i].price - swings.lows[j].price) / swings.lows[i].price;
      if (diff <= tol) {
        eqLows.push({
          price:  (swings.lows[i].price + swings.lows[j].price) / 2,
          index1: swings.lows[i].index, index2: swings.lows[j].index,
          time1:  swings.lows[i].time,  time2:  swings.lows[j].time,
        });
      }
    }
  }

  return { eqHighs, eqLows };
}

// ─── 6. Trade Setup Generator ─────────────────────────────────────────────────
function generateTradeSetup(bars, structure, orderBlocks, equalLevels, swings) {
  const last  = bars[bars.length - 1];
  const price = last.close;
  const { trend } = structure;

  if (trend === 'neutral') return null;

  if (trend === 'bullish') {
    const activeOBs = orderBlocks.bullishOBs.filter(ob => ob.active);
    if (!activeOBs.length) return null;

    const ob = activeOBs[activeOBs.length - 1];
    const entry = ob.high;
    const sl    = ob.low  * 0.9985;

    // TP1 — next swing high above OB
    const nextHighs = swings.highs.filter(h => h.price > ob.high);
    const tp1 = nextHighs.length ? nextHighs[nextHighs.length - 1].price : entry * 1.03;

    // TP2 — EQH above current price, else extended target
    const aboveEqh = equalLevels.eqHighs.filter(e => e.price > price);
    const tp2 = aboveEqh.length ? aboveEqh[aboveEqh.length - 1].price * 1.001 : entry * 1.06;

    const risk = Math.max(entry - sl, 1);
    return {
      direction: 'LONG',
      entry, sl, tp1, tp2,
      rr1: ((tp1 - entry) / risk).toFixed(1),
      rr2: ((tp2 - entry) / risk).toFixed(1),
      note: price > entry ? '⚠️ 現價高於 OB，等待回踩' : '✅ 等待進入 OB 區間',
    };
  }

  if (trend === 'bearish') {
    const activeOBs = orderBlocks.bearishOBs.filter(ob => ob.active);
    if (!activeOBs.length) return null;

    const ob = activeOBs[activeOBs.length - 1];
    const entry = ob.low;
    const sl    = ob.high * 1.0015;

    const nextLows = swings.lows.filter(l => l.price < ob.low);
    const tp1 = nextLows.length ? nextLows[nextLows.length - 1].price : entry * 0.97;

    const belowEql = equalLevels.eqLows.filter(e => e.price < price);
    const tp2 = belowEql.length ? belowEql[0].price * 0.999 : entry * 0.94;

    const risk = Math.max(sl - entry, 1);
    return {
      direction: 'SHORT',
      entry, sl, tp1, tp2,
      rr1: ((entry - tp1) / risk).toFixed(1),
      rr2: ((entry - tp2) / risk).toFixed(1),
      note: price < entry ? '⚠️ 現價低於 OB，等待回升' : '✅ 等待進入 OB 區間',
    };
  }

  return null;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────
function analyzeSMC(bars, lookback = 3) {
  const swings      = detectSwings(bars, lookback);
  const structure   = analyzeMarketStructure(bars, swings);
  const orderBlocks = detectOrderBlocks(bars, structure.events);
  const fvgs        = detectFVG(bars);
  const equalLevels = detectEqualLevels(swings);
  const tradeSetup  = generateTradeSetup(bars, structure, orderBlocks, equalLevels, swings);

  return { bars, swings, structure, orderBlocks, fvgs, equalLevels, tradeSetup };
}
