(() => {
  if (window.__gmgnPaper) return;
  window.__gmgnPaper = true;

  const FEE = { gmgnPct: 0.01, slipPct: 0.01, tipSol: 0.001, prioSol: 0.003, baseSol: 0.000005 };
  const START = 10000;
  let state = { cash: START, positions: {}, fills: [], solUsd: 150 };
  let mint = null, symbol = "?", price = 0, history = [];
  let root, drag = null;

  const money = n => "$" + (Number(n) || 0).toFixed(2);
  const pct = n => (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%";

  function detectMint() {
    const m = location.pathname.match(/\/(?:sol|eth|base|bsc|tron)\/token\/(?:[^/_]+_)?([1-9A-HJ-NP-Za-km-z]{32,44})/i);
    return m ? m[1] : null;
  }

  async function loadState() {
    const d = await chrome.storage.local.get(["paper"]);
    if (d.paper) state = Object.assign(state, d.paper);
  }
  function saveState() {
    chrome.storage.local.set({ paper: { cash: state.cash, positions: state.positions, fills: state.fills.slice(-200), solUsd: state.solUsd } });
  }

  async function fetchPrice(m) {
    try {
      const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + m);
      const j = await r.json();
      const p = (j.pairs || []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      if (!p) return;
      price = Number(p.priceUsd) || price;
      symbol = p.baseToken?.symbol || symbol;
      const ch = Number(p.priceChange?.h24) || 0;
      history = synth(price, ch);
    } catch (e) {}
  }

  function synth(px, ch24) {
    const bars = [];
    let p = px / (1 + ch24 / 100);
    const now = Date.now();
    for (let i = 60; i >= 0; i--) {
      const n = p * (1 + (Math.random() - 0.48) * 0.02);
      bars.push({ t: now - i * 60000, o: p, h: Math.max(p, n), l: Math.min(p, n), c: n });
      p = n;
    }
    bars[bars.length - 1].c = px;
    return bars;
  }

  function netCostSol() {
    return (FEE.tipSol + FEE.prioSol + FEE.baseSol) * state.solUsd;
  }

  function buy(usd) {
    if (!mint || price <= 0 || usd <= 0) return;
    const gas = netCostSol();
    const slip = usd * FEE.slipPct;
    const fee = usd * FEE.gmgnPct;
    const spend = usd + gas;
    if (spend > state.cash) return alert("Not enough demo cash");
    const tokens = (usd - fee - slip) / price;
    const pos = state.positions[mint] || { mint, symbol, tokens: 0, cost: 0 };
    pos.tokens += tokens;
    pos.cost += usd;
    pos.symbol = symbol;
    state.positions[mint] = pos;
    state.cash -= spend;
    state.fills.push({ side: "buy", mint, symbol, usd, tokens, price, fee, slip, gas, ts: Date.now() });
    saveState(); render();
  }

  function sell(frac) {
    const pos = state.positions[mint];
    if (!pos || pos.tokens <= 0 || price <= 0) return;
    const tokens = pos.tokens * frac;
    let usd = tokens * price;
    const slip = usd * FEE.slipPct;
    const fee = usd * FEE.gmgnPct;
    const gas = netCostSol();
    usd = Math.max(0, usd - slip - fee);
    const costPart = pos.cost * (tokens / pos.tokens);
    pos.tokens -= tokens;
    pos.cost -= costPart;
    if (pos.tokens < 1e-12) delete state.positions[mint];
    state.cash += usd - gas;
    state.fills.push({ side: "sell", mint, symbol, usd, tokens, price, fee, slip, gas, ts: Date.now() });
    saveState(); render();
  }

  function drawChart() {
    const c = root.querySelector("canvas");
    if (!c || !history.length) return;
    const ctx = c.getContext("2d");
    const w = c.width = c.clientWidth * devicePixelRatio;
    const h = c.height = 120 * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);
    const xs = history.map(b => b.c);
    const min = Math.min(...xs), max = Math.max(...xs);
    const span = max - min || 1;
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath();
    history.forEach((b, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((b.c - min) / span) * (h - 8) - 4;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  function html() {
    const pos = state.positions[mint];
    const val = pos ? pos.tokens * price : 0;
    const pnl = pos ? val - pos.cost : 0;
    const pnlP = pos && pos.cost ? pnl / pos.cost : 0;
    const eq = state.cash + Object.values(state.positions).reduce((s, p) => s + p.tokens * (p.mint === mint ? price : 0), 0);
    return `
      <div class="hd"><b>GMGN Paper</b> <span class="tag">NO REAL MONEY</span>
        <button data-a="min">_</button><button data-a="x">×</button></div>
      <div class="bd">
        <div class="row"><b>${symbol}</b> <code>${(mint||"").slice(0,6)}…</code> ${money(price)}</div>
        <canvas style="width:100%;height:120px;background:#0b0f14;border-radius:8px"></canvas>
        <div class="row">Cash ${money(state.cash)} · Equity ~${money(eq)}</div>
        <div class="row">Pos ${pos ? pos.tokens.toFixed(4) + " · cost " + money(pos.cost) + " · " + money(pnl) + " (" + pct(pnlP) + ")" : "flat"}</div>
        <div class="fees">Fees/trade: GMGN ${(FEE.gmgnPct*100)}% + slip ${(FEE.slipPct*100)}% + tip/prio/base ~${money(netCostSol())}</div>
        <div class="btns buy">
          <button data-b="10">$10</button><button data-b="50">$50</button>
          <button data-b="100">$100</button><button data-b="500">$500</button>
        </div>
        <div class="btns sell">
          <button data-s="0.25">25%</button><button data-s="0.5">50%</button>
          <button data-s="0.75">75%</button><button data-s="1">100%</button>
        </div>
        <div class="btns"><button data-a="ref">Refresh</button><button data-a="rst">Reset $10k</button></div>
      </div>`;
  }

  function css() {
    const s = document.createElement("style");
    s.textContent = `
      #gmgn-paper{position:fixed;top:72px;right:12px;width:320px;z-index:2147483646;
        background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:12px;
        font:12px/1.4 system-ui,sans-serif;box-shadow:0 12px 40px #000a}
      #gmgn-paper .hd{display:flex;gap:8px;align-items:center;padding:8px 10px;cursor:move;
        background:#0b1220;border-radius:12px 12px 0 0}
      #gmgn-paper .hd button{margin-left:auto;background:#1f2937;color:#fff;border:0;border-radius:6px;padding:2px 8px}
      #gmgn-paper .hd button+button{margin-left:4px}
      #gmgn-paper .tag{color:#fbbf24;font-size:10px}
      #gmgn-paper .bd{padding:10px}
      #gmgn-paper .row{margin:6px 0}
      #gmgn-paper .fees{opacity:.75;font-size:10px;margin:6px 0}
      #gmgn-paper .btns{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px}
      #gmgn-paper .buy button{background:#16a34a;color:#fff;border:0;border-radius:8px;padding:8px;font-weight:700}
      #gmgn-paper .sell button{background:#e11d48;color:#fff;border:0;border-radius:8px;padding:8px;font-weight:700}
      #gmgn-paper .btns button{background:#1f2937;color:#fff;border:0;border-radius:8px;padding:8px}
      #gmgn-paper.collapsed .bd{display:none}`;
    document.documentElement.appendChild(s);
  }

  function render() {
    if (!root) return;
    root.innerHTML = html();
    drawChart();
    root.querySelectorAll("[data-b]").forEach(b => b.onclick = () => buy(Number(b.dataset.b)));
    root.querySelectorAll("[data-s]").forEach(b => b.onclick = () => sell(Number(b.dataset.s)));
    root.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === "x") root.remove();
      if (a === "min") root.classList.toggle("collapsed");
      if (a === "ref") { await fetchPrice(mint); render(); }
      if (a === "rst" && confirm("Reset paper account to $10,000?")) {
        state = { cash: START, positions: {}, fills: [], solUsd: state.solUsd };
        saveState(); render();
      }
    });
    const hd = root.querySelector(".hd");
    hd.onmousedown = e => {
      if (e.target.tagName === "BUTTON") return;
      drag = { x: e.clientX - root.offsetLeft, y: e.clientY - root.offsetTop };
      const move = ev => { root.style.left = (ev.clientX - drag.x) + "px"; root.style.top = (ev.clientY - drag.y) + "px"; root.style.right = "auto"; };
      const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); };
      addEventListener("mousemove", move); addEventListener("mouseup", up);
    };
  }

  async function mount() {
    mint = detectMint();
    if (!mint) return;
    await loadState();
    await fetchPrice(mint);
    if (!document.getElementById("gmgn-paper")) {
      css();
      root = document.createElement("div");
      root.id = "gmgn-paper";
      document.documentElement.appendChild(root);
    } else root = document.getElementById("gmgn-paper");
    render();
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === "TOGGLE_PANEL") {
      const el = document.getElementById("gmgn-paper");
      if (el) el.remove(); else mount();
    }
  });

  let last = location.href;
  setInterval(() => {
    if (location.href !== last) { last = location.href; mount(); }
  }, 1000);
  mount();
})();