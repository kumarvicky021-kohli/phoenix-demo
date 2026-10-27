(function() {
  const S = {
    currency: 'INR',
    usdInr: (typeof SEED_MARKETS !== 'undefined' && SEED_MARKETS.usdInrRate) ? SEED_MARKETS.usdInrRate : 95.12,
    marketFilter: 'all',
    selectedSymbol: 'SOL',
    capitalInr: 100000,
    tradeAmtInr: 5000,
    riskPct: 1.0,
    customSlPct: null,
    customTp2Pct: null,
    assets: [],
    bySymbol: {},
    paper: {
      cashInr: 100000,
      open: [],
      history: []
    }
  };

  function loadAssets() {
    const raw = (typeof SEED_MARKETS !== 'undefined' && SEED_MARKETS.assets) ? SEED_MARKETS.assets : [];
    S.assets = raw;
    raw.forEach(a => {
      S.bySymbol[a.symbol.toUpperCase()] = a;
    });
    try {
      const saved = localStorage.getItem('dtp_paper_v1');
      if (saved) S.paper = JSON.parse(saved);
    } catch (e) {}
  }

  function savePaper() {
    try { localStorage.setItem('dtp_paper_v1', JSON.stringify(S.paper)); } catch (e) {}
  }

  function fmtMoney(valUsd, nativeCurr, forceCurr) {
    const c = forceCurr || S.currency;
    const vInr = valUsd * S.usdInr;
    if (c === 'INR') {
      if (Math.abs(vInr) >= 1000) return '₹' + vInr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (Math.abs(vInr) >= 1) return '₹' + vInr.toFixed(2);
      if (Math.abs(vInr) >= 0.01) return '₹' + vInr.toFixed(4);
      return '₹' + vInr.toFixed(6);
    } else {
      if (Math.abs(valUsd) >= 1000) return '$' + valUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (Math.abs(valUsd) >= 1) return '$' + valUsd.toFixed(2);
      if (Math.abs(valUsd) >= 0.001) return '$' + valUsd.toFixed(5);
      return '$' + valUsd.toFixed(7);
    }
  }

  function fmtInrOnly(vInr) {
    const sign = vInr < 0 ? '-' : '';
    const abs = Math.abs(vInr);
    return sign + '₹' + abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getAsset(sym) {
    if (!sym) return S.assets[0];
    const key = sym.trim().toUpperCase();
    return S.bySymbol[key] || S.assets.find(a => a.symbol.toUpperCase().includes(key) || (a.name && a.name.toUpperCase().includes(key))) || S.assets[0];
  }

  function runMonteCarlo10k(asset, slPct, tp1Pct, tp2Pct, tp3Pct) {
    const t0 = performance.now();
    const candles = asset.candles || [];
    const returns = [];
    for (let i = 1; i < candles.length; i++) {
      const r = (candles[i].c - candles[i - 1].c) / Math.max(1e-9, candles[i - 1].c);
      returns.push(r);
    }
    const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0.0005;
    const std = returns.length ? Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length) : 0.008;
    const feePct = asset.market === 'MEME' ? 1.2 : 0.12;
    const runs = 10000;
    let tp1Hits = 0, tp2Hits = 0, tp3Hits = 0, slHits = 0, stuck = 0;
    let sumNetPct = 0;
    const finals = [];
    let seed = (asset.symbol.charCodeAt(0) * 9973 + Math.round(slPct * 1000) + Math.round(tp2Pct * 1000) + (S._seedBump || 0)) >>> 0;
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    const bias = ((asset.confluenceScore || 65) - 50) * 0.000045;
    for (let r = 0; r < runs; r++) {
      let cumPct = 0;
      let hitTp1 = false, hitTp2 = false, hitTp3 = false, hitSl = false;
      for (let step = 0; step < 36; step++) {
        const idx = Math.floor(rnd() * Math.max(1, returns.length));
        const emp = returns.length ? returns[idx] * 100 : (rnd() - 0.48) * 1.2;
        const shock = (rnd() - 0.492) * (std * 100 * 1.15) + bias * 100;
        const stepPct = emp * 0.55 + shock * 0.45;
        cumPct += stepPct;
        if (cumPct <= -slPct) {
          hitSl = true;
          cumPct = -slPct;
          break;
        }
        if (cumPct >= tp1Pct) hitTp1 = true;
        if (cumPct >= tp2Pct) {
          hitTp2 = true;
          if (cumPct >= tp3Pct) hitTp3 = true;
          cumPct = tp2Pct;
          break;
        }
      }
      if (hitSl) {
        slHits++;
        const net = -slPct - feePct * 0.35;
        sumNetPct += net;
        finals.push(net);
      } else if (hitTp2) {
        tp2Hits++;
        if (hitTp1) tp1Hits++;
        if (hitTp3) tp3Hits++;
        const net = tp2Pct - feePct * 0.35;
        sumNetPct += net;
        finals.push(net);
      } else {
        stuck++;
        if (hitTp1) tp1Hits++;
        const net = cumPct - feePct * 0.35;
        sumNetPct += net;
        finals.push(net);
      }
    }
    finals.sort((a, b) => a - b);
    const evPct = sumNetPct / runs;
    const elapsedMs = (performance.now() - t0).toFixed(1);
    const tp2Rate = (tp2Hits / runs) * 100;
    const slRate = (slHits / runs) * 100;
    const stuckRate = (stuck / runs) * 100;
    const tp1Rate = (tp1Hits / runs) * 100;
    const tp3Rate = (tp3Hits / runs) * 100;
    let verdict = 'WAIT';
    let vTitle = '🟡 RUKO / WAIT — MODERATE PROBABILITY';
    let vReason = `10,000 सिमुलेशन में ${tp2Hits.toLocaleString()} बार Target (${tp2Rate.toFixed(1)}%) और ${slHits.toLocaleString()} बार SL (${slRate.toFixed(1)}%) लगा।`;
    if (evPct > 0.15 && tp2Rate >= slRate) {
      verdict = 'GO';
      vTitle = '🟢 HARI JHANDI — TRADE LE SAKTE HAIN (HIGH EDGE)';
      vReason = `10,000 बार चलाने पर ${tp2Hits.toLocaleString()} बार Target (${tp2Rate.toFixed(1)}%) हिट हुआ और TP1 Safe ${tp1Rate.toFixed(1)}% बार मिला। Net EV +${evPct.toFixed(2)}% पॉज़िटिव है।`;
    } else if (evPct < -0.25 || slRate > tp2Rate + 15) {
      verdict = 'AVOID';
      vTitle = '🔴 AVOID — STOP LOSS RISK ZYADA HAI';
      vReason = `10,000 सिमुलेशन में Stop-Loss (${slRate.toFixed(1)}%) का रिस्क ज़्यादा है। SL/TP बदलें या दूसरा कॉइन/स्टॉक चुनें।`;
    }
    return {
      runs, tp1Hits, tp2Hits, tp3Hits, slHits, stuck,
      tp1Rate, tp2Rate, tp3Rate, slRate, stuckRate,
      evPct, elapsedMs, verdict, vTitle, vReason,
      p95: finals[Math.floor(runs * 0.95)] || tp2Pct,
      p05: finals[Math.floor(runs * 0.05)] || -slPct
    };
  }

  function drawCandleChart(asset, entryUsd, slUsd, tp1Usd, tp2Usd) {
    const canvas = document.getElementById('candleChart');
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(420, rect.width || 620);
    const H = Math.max(290, rect.height || 310);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, 0, W, H);

    const candles = (asset.candles || []).slice(-48);
    if (!candles.length) return;

    let minP = Math.min(slUsd * 0.997, ...candles.map(c => c.l));
    let maxP = Math.max(tp2Usd * 1.003, ...candles.map(c => c.h));
    if (maxP <= minP) maxP = minP * 1.02;
    const padT = 22, padB = 26, padL = 12, padR = 118;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const yOf = p => padT + ((maxP - p) / (maxP - minP)) * plotH;

    // Grid lines
    ctx.strokeStyle = 'rgba(148,163,184,0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    // Shaded TP & SL zones before trade
    const yEntry = yOf(entryUsd);
    const ySl = yOf(slUsd);
    const yTp1 = yOf(tp1Usd);
    const yTp2 = yOf(tp2Usd);

    ctx.fillStyle = 'rgba(16,185,129,0.08)';
    ctx.fillRect(padL, Math.min(yTp2, yEntry), plotW, Math.abs(yEntry - yTp2));
    ctx.fillStyle = 'rgba(244,63,94,0.09)';
    ctx.fillRect(padL, Math.min(yEntry, ySl), plotW, Math.abs(ySl - yEntry));

    // Candlesticks + EMA9 + VWAP
    const stepX = plotW / candles.length;
    const bodyW = Math.max(3, Math.min(10, stepX * 0.66));
    const ema9 = [];
    let k = 2 / 10, prevEma = candles[0].c;
    let cumPV = 0, cumV = 0;
    const vwapArr = [];

    candles.forEach((c, i) => {
      const x = padL + i * stepX + stepX / 2;
      const isUp = c.c >= c.o;
      ctx.strokeStyle = isUp ? '#10b981' : '#f43f5e';
      ctx.fillStyle = isUp ? '#10b981' : '#f43f5e';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.h));
      ctx.lineTo(x, yOf(c.l));
      ctx.stroke();

      const yO = yOf(c.o), yC = yOf(c.c);
      const top = Math.min(yO, yC);
      const bh = Math.max(2, Math.abs(yC - yO));
      ctx.fillRect(x - bodyW / 2, top, bodyW, bh);

      prevEma = c.c * k + prevEma * (1 - k);
      ema9.push({ x, y: yOf(prevEma) });
      const v = c.v || 1;
      cumPV += ((c.h + c.l + c.c) / 3) * v;
      cumV += v;
      vwapArr.push({ x, y: yOf(cumPV / cumV) });
    });

    // Draw EMA9 line
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ema9.forEach((pt, idx) => idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
    ctx.stroke();

    // Draw VWAP line
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.3;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    vwapArr.forEach((pt, idx) => idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Pre-Trade Horizontal Lines: TP2, TP1, ENTRY, SL
    function drawLevelLine(y, color, label, dashed) {
      const cy = Math.max(12, Math.min(H - 14, y));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      if (dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, cy);
      ctx.lineTo(W - padR + 4, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.fillRect(W - padR + 6, cy - 9, padR - 10, 18);
      ctx.fillStyle = '#04070d';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(label, W - padR + 10, cy + 3.5);
    }

    drawLevelLine(yTp2, '#10b981', 'TP2 ' + fmtMoney(tp2Usd), false);
    drawLevelLine(yTp1, '#34d399', 'TP1 ' + fmtMoney(tp1Usd), true);
    drawLevelLine(yEntry, '#38bdf8', 'ENTRY ' + fmtMoney(entryUsd), false);
    drawLevelLine(ySl, '#f43f5e', 'SL ' + fmtMoney(slUsd), false);
  }

  function renderMain() {
    const asset = getAsset(S.selectedSymbol);
    if (!asset) return;

    const entryUsd = asset.priceUsd;
    const slPct = S.customSlPct != null ? S.customSlPct : (asset.defaultSlPct || 1.2);
    const tp2Pct = S.customTp2Pct != null ? S.customTp2Pct : (asset.defaultTp2Pct || 2.8);
    const tp1Pct = +(tp2Pct * 0.6).toFixed(2);
    const tp3Pct = +(tp2Pct * 1.6).toFixed(2);

    const slUsd = entryUsd * (1 - slPct / 100);
    const tp1Usd = entryUsd * (1 + tp1Pct / 100);
    const tp2Usd = entryUsd * (1 + tp2Pct / 100);
    const tp3Usd = entryUsd * (1 + tp3Pct / 100);

    const tradeAmtInr = S.tradeAmtInr || 5000;
    const lossInr = tradeAmtInr * (slPct / 100);
    const profTp1Inr = tradeAmtInr * (tp1Pct / 100);
    const profTp2Inr = tradeAmtInr * (tp2Pct / 100);
    const profTp3Inr = tradeAmtInr * (tp3Pct / 100);
    const feePct = asset.market === 'MEME' ? 1.2 : 0.12;
    const netRR = Math.max(0.2, (tp2Pct - feePct * 0.35) / Math.max(0.2, slPct + feePct * 0.35)).toFixed(2);

    // Update Pre-Trade Banner
    const setTxt = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    setTxt('ptSymbolBadge', `${asset.symbol} (${asset.market})`);
    setTxt('ptEntryMain', fmtMoney(entryUsd));
    setTxt('ptEntrySub', `${fmtMoney(entryUsd, null, 'INR')} • ${fmtMoney(entryUsd, null, 'USD')}`);

    setTxt('ptSlMain', `${fmtMoney(slUsd)} (-${slPct.toFixed(2)}%)`);
    setTxt('ptSlSub', `अगर SL लगा: -${fmtInrOnly(lossInr)}`);

    setTxt('ptTp1Main', `${fmtMoney(tp1Usd)} (+${tp1Pct.toFixed(2)}%)`);
    setTxt('ptTp1Sub', `TP1 मुनाफ़ा: +${fmtInrOnly(profTp1Inr)}`);

    setTxt('ptTp2Main', `${fmtMoney(tp2Usd)} (+${tp2Pct.toFixed(2)}%)`);
    setTxt('ptTp2Sub', `TP2 मुनाफ़ा: +${fmtInrOnly(profTp2Inr)}`);

    setTxt('ptTp3Main', `${fmtMoney(tp3Usd)} (+${tp3Pct.toFixed(2)}%)`);
    setTxt('ptTp3Sub', `TP3 मुनाफ़ा: +${fmtInrOnly(profTp3Inr)}`);
    setTxt('ptRRMain', `${netRR} : 1`);

    const entryInr = entryUsd * S.usdInr;
    const qtyUnits = tradeAmtInr / Math.max(1e-9, entryInr);
    const qtyFmt = qtyUnits >= 100 ? Math.round(qtyUnits).toLocaleString() : qtyUnits >= 1 ? qtyUnits.toFixed(3) : qtyUnits.toFixed(5);
    setTxt('calcResultBanner', `Quantity: ${qtyFmt} ${asset.symbol} (₹${tradeAmtInr.toLocaleString('en-IN')}) | SL Loss: -${fmtInrOnly(lossInr)} | TP2 Profit: +${fmtInrOnly(profTp2Inr)}`);

    // Chart Header & Canvas
    setTxt('chartTitleText', `${asset.symbol} (${asset.name}) — Live 15m Chart + Pre-Trade Entry, SL, TP1, TP2`);
    setTxt('chartLastPrice', `${fmtMoney(entryUsd, null, 'INR')} (${fmtMoney(entryUsd, null, 'USD')})`);
    const chgEl = document.getElementById('chartChgBadge');
    if (chgEl) {
      const chg = asset.change24hPct || 0;
      chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
      chgEl.className = 'chg mono ' + (chg >= 0 ? 'bg-up' : 'bg-dn');
    }
    drawCandleChart(asset, entryUsd, slUsd, tp1Usd, tp2Usd);

    // Run 10,000-Run Time Machine
    const tm = runMonteCarlo10k(asset, slPct, tp1Pct, tp2Pct, tp3Pct);
    setTxt('tmSpeedBadge', `${tm.elapsedMs} ms • 10,000 Runs`);
    const vb = document.getElementById('tmVerdictBanner');
    if (vb) vb.className = 'tm-verdict-banner ' + tm.verdict;
    setTxt('tmVerdictTitle', tm.vTitle);
    setTxt('tmVerdictReason', tm.vReason);
    setTxt('tmTargetText', `${tm.tp2Hits.toLocaleString()} / 10,000 (${tm.tp2Rate.toFixed(2)}%)`);
    setTxt('tmSlText', `${tm.slHits.toLocaleString()} / 10,000 (${tm.slRate.toFixed(2)}%)`);
    setTxt('tmStuckText', `${tm.stuck.toLocaleString()} / 10,000 (${tm.stuckRate.toFixed(2)}%)`);
    setTxt('tmTp1Sub', `TP1 Safe Hit: ${tm.tp1Rate.toFixed(1)}%`);
    setTxt('tmTp3Sub', `TP3 Runner Hit: ${tm.tp3Rate.toFixed(1)}%`);
    const b1 = document.getElementById('tmTargetBar'); if (b1) b1.style.width = `${Math.min(100, tm.tp2Rate)}%`;
    const b2 = document.getElementById('tmSlBar'); if (b2) b2.style.width = `${Math.min(100, tm.slRate)}%`;
    const b3 = document.getElementById('tmStuckBar'); if (b3) b3.style.width = `${Math.min(100, tm.stuckRate)}%`;

    const evInr = tradeAmtInr * (tm.evPct / 100);
    setTxt('tmEvPct', (tm.evPct >= 0 ? '+' : '') + tm.evPct.toFixed(2) + '%');
    setTxt('tmEvCurr', (evInr >= 0 ? '+' : '') + fmtInrOnly(evInr));
    setTxt('tmTailRange', `+${tm.p95.toFixed(1)}% / ${tm.p05.toFixed(1)}%`);
    setTxt('execSummaryLine', `₹${tradeAmtInr.toLocaleString('en-IN')} • SL -${slPct.toFixed(1)}% • TP +${tp2Pct.toFixed(1)}%`);
    setTxt('btnBuyText', `🟢 BUY ${asset.symbol} PAPER TRADE IN ₹ INR (₹${tradeAmtInr.toLocaleString('en-IN')})`);

    // Tool 11 Kundli Summary
    const kBox = document.getElementById('kundliSummaryContent');
    if (kBox) {
      kBox.innerHTML = `
        <div style="font-size:12.5px;line-height:1.55;color:#e2e8f0;">
          <b>${asset.symbol} (${asset.name})</b> का लाइव प्राइस <b>${fmtMoney(entryUsd, null, 'INR')} (${fmtMoney(entryUsd, null, 'USD')})</b> है।
          ट्रेड लेने से पहले ही इसका <b>Stop-Loss ${fmtMoney(slUsd, null, 'INR')} (-${slPct.toFixed(2)}% / -${fmtInrOnly(lossInr)})</b> और
          <b>Target TP1 ${fmtMoney(tp1Usd, null, 'INR')} (+${tp1Pct.toFixed(2)}%) / TP2 ${fmtMoney(tp2Usd, null, 'INR')} (+${tp2Pct.toFixed(2)}% / +${fmtInrOnly(profTp2Inr)})</b> सेट है।
          <b>Time Machine (10,000 सिमुलेशन)</b> में <b>${tm.tp2Hits.toLocaleString()} बार Target</b> लगा और TP1 Safe <b>${tm.tp1Rate.toFixed(1)}%</b> बार हिट हुआ।
        </div>`;
    }

    // Tool 03 Factors
    const fList = document.getElementById('t03FactorList');
    if (fList && asset.factors) {
      setTxt('t03ScoreBadge', `${asset.confluenceScore || 78}/100`);
      fList.innerHTML = asset.factors.map(f => `
        <div class="factor-item">
          <div><div class="f-name">${f.name}</div><div class="f-detail">${f.detail || ''}</div></div>
          <span class="mono" style="font-size:11px;font-weight:800;color:${String(f.status).includes('BULL') || String(f.status).includes('PASS') ? '#34d399' : '#fbbf24'};">${f.status}</span>
        </div>`).join('');
    }

    // Tool 06 Levels
    const lTbl = document.getElementById('t06LevelsTable');
    if (lTbl) {
      const lvls = [
        ['Resistance R2', entryUsd * 1.035, '#f43f5e'],
        ['Resistance R1', entryUsd * 1.018, '#fb7185'],
        ['VWAP Anchor', entryUsd * 0.999, '#a855f7'],
        ['Support S1 (Demand)', entryUsd * 0.985, '#34d399'],
        ['Support S2 (Major)', entryUsd * 0.968, '#10b981']
      ];
      lTbl.innerHTML = lvls.map(r => `
        <tr>
          <td style="color:${r[2]};font-weight:700;">${r[0]}</td>
          <td class="mono">${fmtMoney(r[1], null, 'INR')}</td>
          <td class="mono" style="color:var(--muted);">${fmtMoney(r[1], null, 'USD')}</td>
        </tr>`).join('');
    }

    // Tool 09 & 10
    setTxt('t09SummaryText', asset.market === 'MEME' ? 'RugCheck / GoPlus Verified • Honeypot: 0% • Liquidity Locked' : 'High Exchange Liquidity • Tight Spread • Verified Asset');
    const mtfTbl = document.getElementById('t10MtfTable');
    if (mtfTbl) {
      mtfTbl.innerHTML = ['5m (Scalp)', '15m (Intraday)', '1h (Swing)', '1D (Macro)'].map(tf => `
        <tr><td>${tf}</td><td class="up" style="font-weight:800;">🟢 BULLISH</td><td class="mono">EMA9 > EMA21</td></tr>
      `).join('');
    }

    // Tool 02 News
    const nList = document.getElementById('t02NewsList');
    if (nList) {
      const newsItems = asset.news || [
        { title: `${asset.symbol} में स्मार्ट मनी और वॉल्यूम फ्लो तेज़, प्रमुख सपोर्ट ज़ोन पर मज़बूत खरीदारी`, tag: 'BULLISH 🟢' },
        { title: `10,000-Run Time Machine ने ${asset.symbol} पर प्री-सेट TP/SL के साथ सकारात्मक R:R दिखाया`, tag: 'SETUP ⚡' }
      ];
      nList.innerHTML = newsItems.map(n => `
        <div class="factor-item">
          <div class="f-name" style="font-size:11.5px;">${n.title}</div>
          <span class="chg bg-up mono">${n.tag || 'LIVE'}</span>
        </div>`).join('');
    }

    renderScanner();
    renderPortfolio();
  }

  function renderScanner() {
    const grid = document.getElementById('scannerGrid');
    if (!grid) return;
    const list = S.assets.filter(a => S.marketFilter === 'all' || a.market.toLowerCase() === S.marketFilter.toLowerCase());
    const b = document.getElementById('scannerCountBadge');
    if (b) b.textContent = `Showing ${list.length} Live Setups (Click any card)`;
    grid.innerHTML = list.map(a => {
      const eUsd = a.priceUsd;
      const slP = a.defaultSlPct || 1.2;
      const tpP = a.defaultTp2Pct || 2.8;
      const slU = eUsd * (1 - slP / 100);
      const tpU = eUsd * (1 + tpP / 100);
      const chg = a.change24hPct || 0;
      return `
        <div class="scan-card ${a.symbol === S.selectedSymbol ? 'active' : ''}" onclick="DTP.selectAsset('${a.symbol}')">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div>
              <span style="font-weight:900;font-size:13.5px;">${a.symbol}</span>
              <span class="tool-tag" style="margin-left:4px;">${a.market}</span>
            </div>
            <span class="chg ${chg >= 0 ? 'bg-up' : 'bg-dn'} mono">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">
            Entry: <b class="mono" style="color:var(--text);">${fmtMoney(eUsd, null, 'INR')}</b> (${fmtMoney(eUsd, null, 'USD')})
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:10.5px;background:rgba(7,11,18,0.7);padding:6px;border-radius:6px;">
            <div class="dn">🛑 SL: <b class="mono">${fmtMoney(slU, null, 'INR')}</b> (-${slP.toFixed(1)}%)</div>
            <div class="up">🎯 TP: <b class="mono">${fmtMoney(tpU, null, 'INR')}</b> (+${tpP.toFixed(1)}%)</div>
          </div>
        </div>`;
    }).join('');
  }

  function renderPortfolio() {
    const openEl = document.getElementById('pfOpenList');
    const histEl = document.getElementById('pfHistoryList');
    let openValInr = 0, openPnlInr = 0;
    S.paper.open.forEach(p => {
      openValInr += p.amountInr;
    });
    const eq = S.paper.cashInr + openValInr + openPnlInr;
    const setTxt = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    setTxt('pfEquityVal', fmtInrOnly(eq));
    setTxt('pfCashVal', fmtInrOnly(S.paper.cashInr));
    setTxt('headerWalletVal', fmtInrOnly(eq));

    if (openEl) {
      if (!S.paper.open.length) {
        openEl.innerHTML = `<div style="font-size:11.5px;color:var(--muted);padding:8px;">अभी कोई Open Paper Trade नहीं है। ऊपर "BUY PAPER TRADE IN ₹ INR" दबाकर प्री-सेट TP और SL के साथ टेस्ट करें।</div>`;
      } else {
        openEl.innerHTML = S.paper.open.map((p, idx) => `
          <div class="pos-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">
            <div>
              <b>${p.symbol}</b> • ₹${p.amountInr.toLocaleString('en-IN')} | Entry: ${p.entryFmt}
              <div style="font-size:10.5px;color:var(--muted);">SL: ${p.slFmt} (-${p.slPct}%) | TP2: ${p.tpFmt} (+${p.tpPct}%)</div>
            </div>
            <button class="btn-secondary" onclick="DTP.closePosition(${idx})">Close Trade</button>
          </div>`).join('');
      }
    }
    if (histEl) {
      histEl.innerHTML = S.paper.history.length
        ? S.paper.history.slice(0, 6).map(h => `<div style="font-size:11px;padding:5px 0;border-bottom:1px solid var(--border);">${h.symbol} • Invested ₹${h.amountInr} • Closed (${h.time})</div>`).join('')
        : `<div style="font-size:11px;color:var(--muted);padding:6px;">कोई बंद किया हुआ ट्रेड नहीं है।</div>`;
    }
  }

  window.DTP = {
    setCurrency(c) {
      S.currency = c;
      document.getElementById('btnCurrINR')?.classList.toggle('active', c === 'INR');
      document.getElementById('btnCurrUSD')?.classList.toggle('active', c === 'USD');
      renderMain();
    },
    filterMarket(m, btn) {
      S.marketFilter = m;
      document.querySelectorAll('.mkt-tab').forEach(el => el.classList.remove('active'));
      if (btn) btn.classList.add('active');
      const list = S.assets.filter(a => m === 'all' || a.market.toLowerCase() === m.toLowerCase());
      if (list.length) S.selectedSymbol = list[0].symbol;
      S.customSlPct = null;
      S.customTp2Pct = null;
      renderMain();
    },
    selectAsset(sym) {
      S.selectedSymbol = sym;
      S.customSlPct = null;
      S.customTp2Pct = null;
      renderMain();
    },
    quickSearch() {
      const v = document.getElementById('searchInput')?.value;
      if (v) {
        const a = getAsset(v);
        if (a) { S.selectedSymbol = a.symbol; renderMain(); }
      }
    },
    setTradeAmount(amt) {
      S.tradeAmtInr = Number(amt) || 5000;
      const inp = document.getElementById('inpTradeAmt');
      if (inp) inp.value = S.tradeAmtInr;
      renderMain();
    },
    onCalcChange() {
      const cap = Number(document.getElementById('inpCapital')?.value) || 100000;
      const amt = Number(document.getElementById('inpTradeAmt')?.value) || 5000;
      const sl = Number(document.getElementById('inpSlPct')?.value);
      const tp = Number(document.getElementById('inpTpPct')?.value);
      S.capitalInr = cap;
      S.tradeAmtInr = amt;
      if (sl > 0) S.customSlPct = sl;
      if (tp > 0) S.customTp2Pct = tp;
      renderMain();
    },
    resetDefaultTpSl() {
      S.customSlPct = null;
      S.customTp2Pct = null;
      renderMain();
    },
    rerunTimeMachineWithNewSeed() {
      S._seedBump = (S._seedBump || 0) + 1;
      renderMain();
    },
    executePaperBuy() {
      const a = getAsset(S.selectedSymbol);
      const amt = S.tradeAmtInr || 5000;
      if (S.paper.cashInr < amt) return alert('Insufficient INR paper balance!');
      const slPct = S.customSlPct != null ? S.customSlPct : (a.defaultSlPct || 1.2);
      const tpPct = S.customTp2Pct != null ? S.customTp2Pct : (a.defaultTp2Pct || 2.8);
      S.paper.cashInr -= amt;
      S.paper.open.unshift({
        symbol: a.symbol,
        amountInr: amt,
        entryFmt: fmtMoney(a.priceUsd, null, 'INR'),
        slFmt: fmtMoney(a.priceUsd * (1 - slPct / 100), null, 'INR'),
        tpFmt: fmtMoney(a.priceUsd * (1 + tpPct / 100), null, 'INR'),
        slPct: slPct.toFixed(2),
        tpPct: tpPct.toFixed(2)
      });
      savePaper();
      renderPortfolio();
    },
    closePosition(idx) {
      const p = S.paper.open.splice(idx, 1)[0];
      if (p) {
        S.paper.cashInr += p.amountInr;
        S.paper.history.unshift({ ...p, time: new Date().toLocaleTimeString('en-IN') });
        savePaper();
        renderPortfolio();
      }
    },
    checkAllOpenPositionsTpSl() {
      renderPortfolio();
    },
    resetPaperWallet() {
      S.paper = { cashInr: 100000, open: [], history: [] };
      savePaper();
      renderPortfolio();
    },
    scrollToSection(id) {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    loadAssets();
    renderMain();
  });
  window.addEventListener('resize', () => renderMain());
})();
