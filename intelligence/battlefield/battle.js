// BTC Intel — Market Battlefield.
// A visualization of market structure, not a prediction engine.
//   x axis  = price (the front line is the aggregated mid)
//   bulls   = resting bids (buyers), bears = resting asks (sellers)
//   size    = displayed order-book liquidity in each price band
//   strikes = large aggressive trades, explosions = liquidations
import { connectLive, BookSet } from './feeds.js';
import { Sprites } from './sprites.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmtUsd = (v, d) => { if (v === null || v === undefined || !Number.isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(d ?? 2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(d ?? 1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(d ?? 0)}K` : `${s}$${a.toFixed(0)}`; };
const fmtPx = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
const fmtPct = (v, d = 2) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%` : '—');
const ago = (t) => { if (!t) return 'never'; const s = Math.max(0, (clock() - t) / 1000); return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- state
const S = {
  mode: 'connecting', // live | replay | connecting
  rangePct: 0.5, bigTrade: 250000, fxTrade: 100000, speed: 1, paused: false,
  book: null, mid: null, cam: null, prevMids: [],
  trades: [], liqs: [], flowSec: [], tickers: {}, funding: null, oi: null, server: null,
  venues: {}, lastBookAt: 0, sessionStart: null,
  replay: null,
};
let clockOffset = 0; // replay maps wall time to recorded time
const clock = () => Date.now() + clockOffset;

// ---------------------------------------------------------------- event intake
function onEvent(e) {
  if (e.type === 'status') { S.venues[e.venue] = { state: e.state, note: e.note, at: Date.now() }; renderVenues(); return; }
  if (!S.sessionStart) S.sessionStart = e.t || clock();
  switch (e.type) {
    case 'trade':
      if (!(e.usd > 0)) return;
      S.flowSec.push({ t: e.t, side: e.side, usd: e.usd });
      if (e.usd >= Math.min(S.bigTrade, S.fxTrade)) {
        S.trades.push(e);
        if (e.usd >= S.fxTrade) fx.strike(e);
        if (e.usd >= S.bigTrade) tape(e);
      }
      break;
    case 'flow': S.flowSec.push({ t: e.t, side: e.side, usd: e.usd }); break;
    case 'liq': S.liqs.push(e); fx.explode(e); tape(e); break;
    case 'ticker': S.tickers[e.venue] = { ...e }; break;
    case 'funding': S.funding = e; break;
    case 'oi': S.oi = e; break;
  }
}

// ---------------------------------------------------------------- sources
let live = null;
function startLive() {
  stopAll();
  S.mode = 'connecting'; clockOffset = 0; resetSession();
  live = connectLive(onEvent);
  const iv = setInterval(() => {
    if (!live) return clearInterval(iv);
    const mid = live.books.mid(20000);
    if (!mid) return;
    S.book = live.books.aggregate(mid, 2, bucketFor(mid));
    S.lastBookAt = Date.now();
    setMid(mid);
    if (S.mode !== 'live') { S.mode = 'live'; renderMode(); }
  }, 250);
  live.iv = iv;
  // If nothing usable arrives, fall back to the recorded replay.
  setTimeout(() => { if (S.mode === 'connecting') { note('Live exchange feeds could not be reached from this browser — showing the recorded replay instead.'); startReplay(); } }, 9000);
  renderMode();
}
function stopAll() {
  if (live) { clearInterval(live.iv); live.stop(); live = null; }
  if (S.replay) { S.replay.stop = true; S.replay = null; }
}
function resetSession() { S.trades = []; S.liqs = []; S.flowSec = []; S.tickers = {}; S.funding = null; S.oi = null; S.book = null; S.mid = null; S.cam = null; S.prevMids = []; S.sessionStart = null; tapeEl.replaceChildren(); fx.clear(); }

async function startReplay() {
  stopAll();
  resetSession();
  S.mode = 'connecting'; renderMode();
  let data;
  for (const u of ['replay.json', 'battlefield/replay.json']) { try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) { data = await r.json(); break; } } catch {} }
  if (!data || !data.frames?.length) { S.mode = 'none'; renderMode(); note('No recorded replay is available yet.'); return; }
  const R = { data, i: 0, j: 0, t0: data.frames[0].t, stop: false };
  S.replay = R;
  S.mode = 'replay'; renderMode();
  R.venueStatus = data.venueStatus || {};
  S.venues = Object.fromEntries(Object.entries(R.venueStatus).map(([k, v]) => [k, { state: v.state === 'live' || v.liveAt ? 'recorded' : 'unavailable', note: v.note }]));
  renderVenues();
  let vt = R.t0, last = performance.now();
  const step = () => {
    if (R.stop) return;
    const now = performance.now();
    const dt = Math.min(250, now - last); last = now;
    if (!S.paused) vt += dt * S.speed;
    clockOffset = vt - Date.now();
    const F = data.frames;
    while (R.i < F.length - 1 && F[R.i + 1].t <= vt) R.i++;
    const f = F[R.i];
    if (f && S.bookT !== f.t) {
      S.bookT = f.t;
      S.book = { mid: f.mid, bucketUsd: data.bucketUsd, venues: Array(f.v).fill(''), bids: f.b, asks: f.a };
      S.lastBookAt = Date.now();
      setMid(f.mid);
    }
    const E = data.events;
    while (R.j < E.length && E[R.j].t <= vt) onEvent(E[R.j++]);
    if (vt >= F.at(-1).t) { // loop
      R.i = 0; R.j = 0; vt = R.t0; resetSession(); S.replayLoops = (S.replayLoops || 0) + 1;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function bucketFor(mid) { return mid > 50000 ? 10 : mid > 10000 ? 5 : 1; }
function setMid(mid) {
  S.mid = mid;
  if (S.cam === null) S.cam = mid;
  const t = clock();
  if (!S.prevMids.length || t - S.prevMids.at(-1)[0] > 1000) S.prevMids.push([t, mid]);
  S.prevMids = S.prevMids.filter(([x]) => t - x < 3600e3);
}

// ---------------------------------------------------------------- metrics
function prune() {
  const t = clock();
  S.flowSec = S.flowSec.filter((x) => t - x.t < 300e3);
  S.trades = S.trades.filter((x) => t - x.t < 3600e3);
  S.liqs = S.liqs.filter((x) => t - x.t < 24 * 3600e3);
}
function metrics() {
  const t = clock(), B = S.book, mid = S.mid;
  const m = { mid };
  if (B && mid) {
    const within = (arr, pct) => arr.filter(([p]) => Math.abs(p - mid) / mid <= pct / 100).reduce((s, [, u]) => s + u, 0);
    m.bid05 = within(B.bids, 0.5); m.ask05 = within(B.asks, 0.5);
    m.bid1 = within(B.bids, 1); m.ask1 = within(B.asks, 1);
    m.imb05 = (m.bid05 - m.ask05) / ((m.bid05 + m.ask05) || 1);
    m.imb1 = (m.bid1 - m.ask1) / ((m.bid1 + m.ask1) || 1);
    // walls: largest single price band within ±1%, merged to $50 bands so a wall split across ticks still reads as one
    const band = (arr) => { const g = new Map(); for (const [p, u] of arr) { if (Math.abs(p - mid) / mid > 0.01) continue; const k = Math.round(p / WALL_BAND) * WALL_BAND; g.set(k, (g.get(k) || 0) + u); } return [...g.entries()].sort((a, b) => b[1] - a[1])[0] || null; };
    m.buyWall = band(B.bids); m.sellWall = band(B.asks);
    m.venueCount = B.venues?.length || 0;
  }
  const f60 = S.flowSec.filter((x) => t - x.t < 60e3);
  m.buy60 = f60.filter((x) => x.side === 'buy').reduce((s, x) => s + x.usd, 0);
  m.sell60 = f60.filter((x) => x.side === 'sell').reduce((s, x) => s + x.usd, 0);
  m.flowImb = (m.buy60 - m.sell60) / ((m.buy60 + m.sell60) || 1);
  const lw = (side, ms) => S.liqs.filter((x) => x.side === side && t - x.t < ms).reduce((s, x) => s + x.usd, 0);
  m.longLiq1h = lw('long', 3600e3); m.shortLiq1h = lw('short', 3600e3);
  m.longLiqS = lw('long', 1e15); m.shortLiqS = lw('short', 1e15);
  m.longLiq15 = lw('long', 900e3); m.shortLiq15 = lw('short', 900e3);
  const lt = S.trades.filter((x) => x.usd >= S.bigTrade && t - x.t < 900e3);
  m.bigCount = lt.length; m.bigBuy = lt.filter((x) => x.side === 'buy').reduce((s, x) => s + x.usd, 0); m.bigSell = lt.filter((x) => x.side === 'sell').reduce((s, x) => s + x.usd, 0);
  m.largest = lt.slice().sort((a, b) => b.usd - a.usd)[0] || null;
  const tk = S.tickers.Coinbase || S.tickers.Kraken || S.tickers.OKX;
  m.ch24 = tk?.ch24 ?? null; m.ch24Venue = tk?.venue;
  m.vol24 = Object.values(S.tickers).reduce((s, x) => s + (x.vol24Usd || 0), 0); m.volVenues = Object.keys(S.tickers);
  const p5 = S.prevMids.find(([x]) => t - x <= 300e3);
  m.mom5 = p5 && mid ? ((mid - p5[1]) / p5[1]) * 100 : null;
  // MODELED pressure index: weights are a presentation choice, not estimated
  const liqTot = m.longLiq15 + m.shortLiq15;
  const liqImb = liqTot ? (m.shortLiq15 - m.longLiq15) / liqTot : 0;
  m.pressure = Math.round(100 * clamp(0.5 * m.flowImb + 0.3 * (m.imb05 ?? 0) + 0.2 * liqImb, -1, 1));
  return m;
}

// ---------------------------------------------------------------- effects
const fx = {
  list: [], parts: [], shake: 0,
  clear() { this.list = []; this.parts = []; },
  strike(e) { if (this.list.length > 80) return; this.list.push({ kind: 'strike', e, born: performance.now(), life: 1400 }); },
  explode(e) {
    this.list.push({ kind: 'boom', e, born: performance.now(), life: 3200 + Math.min(3000, Math.sqrt(e.usd) * 1.5) });
    if (!reduced) this.shake = Math.max(this.shake, clamp(e.usd / 200000, 0, 16));
  },
};
const sprites = new Sprites();
const WALL_BAND = 50, WALL_MULT = 4, WALL_MIN_USD = 2e6;

// ---------------------------------------------------------------- renderer
const cv = $('#field'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const display = new Map(); // bucket key → displayed unit count (eased)
const routed = []; // units swept when the line moves through their band
let grain = null;
function resize() {
  const r = cv.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  grain = makeGrain();
}
function makeGrain() {
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const x = c.getContext('2d'), d = x.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 9; }
  x.putImageData(d, 0, 0); return c;
}
new ResizeObserver(resize).observe(cv);

// perspective: z ∈ [0,1], 0 = nearest rank
const HZ = () => H * 0.27, GB = () => H * 0.9;
const persp = (z) => 1 / (1 + z * 2.6);
const P1 = persp(1);
const yAt = (z) => HZ() + (GB() - HZ()) * ((persp(z) - P1) / (1 - P1));
const sAt = (z) => 0.32 + 0.68 * ((persp(z) - P1) / (1 - P1));
const pxPerUsd = () => (W * 0.46) / (S.cam * S.rangePct / 100);
const xAt = (price, z) => W / 2 + (price - S.cam) * pxPerUsd() * sAt(z);
const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

let lastFrame = performance.now(), gaitT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(64, now - lastFrame); lastFrame = now;
  if (!W) return;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  // camera eases toward the front line so advances are visible before it recentres
  if (S.mid && S.cam !== null) S.cam += (S.mid - S.cam) * (1 - Math.exp(-dt / 2200));
  let sx = 0, sy = 0;
  if (fx.shake > 0.2) { sx = (Math.random() - 0.5) * fx.shake; sy = (Math.random() - 0.5) * fx.shake * 0.6; fx.shake *= Math.exp(-dt / 180); } else fx.shake = 0;
  g.save(); g.translate(sx, sy);
  drawSky();
  if (S.mid && S.cam) {
    drawGround();
    drawZones();
    const m = metrics();
    gaitT += dt;
    drawArmies(dt, m);
    drawFront(m, now);
    drawFx(now);
    drawAxis();
  } else {
    g.fillStyle = 'rgba(200,210,225,.6)'; g.font = '500 13px "IBM Plex Mono", monospace'; g.textAlign = 'center';
    g.fillText(S.mode === 'none' ? 'No data source available' : 'Connecting to exchange order books…', W / 2, H / 2);
  }
  g.restore();
  drawVignette();
}

function drawSky() {
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#050a14'); sky.addColorStop(0.25, '#0b1526'); sky.addColorStop(0.3, '#16233a'); sky.addColorStop(0.62, '#0c1628'); sky.addColorStop(1, '#070d18');
  g.fillStyle = sky; g.fillRect(-20, -20, W + 40, H + 40);
  // horizon haze and distant ridge
  const hz = HZ();
  const haze = g.createLinearGradient(0, hz - 60, 0, hz + 40);
  haze.addColorStop(0, 'rgba(70,100,150,0)'); haze.addColorStop(0.6, 'rgba(70,100,150,.16)'); haze.addColorStop(1, 'rgba(70,100,150,0)');
  g.fillStyle = haze; g.fillRect(0, hz - 60, W, 100);
  g.fillStyle = 'rgba(8,14,26,.9)';
  g.beginPath(); g.moveTo(0, hz);
  for (let x = 0; x <= W; x += 24) g.lineTo(x, hz - 6 - 10 * (0.5 + 0.5 * Math.sin(x * 0.011)) - 7 * hash(Math.floor(x / 24)));
  g.lineTo(W, hz); g.closePath(); g.fill();
}

function gridStep() {
  const span = S.cam * S.rangePct / 100 * 2;
  return [5, 10, 25, 50, 100, 250, 500, 1000, 2500].find((s) => span / s <= 14) || 5000;
}
function drawGround() {
  const step = gridStep();
  const lo = S.cam * (1 - S.rangePct / 100 * 1.25), hi = S.cam * (1 + S.rangePct / 100 * 1.25);
  g.lineWidth = 1;
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const major = p % (step * 2) === 0;
    g.strokeStyle = major ? 'rgba(120,150,200,.13)' : 'rgba(120,150,200,.06)';
    g.beginPath(); g.moveTo(xAt(p, 0), yAt(0)); g.lineTo(xAt(p, 1), yAt(1)); g.stroke();
  }
  for (const z of [0, 0.15, 0.32, 0.52, 0.75, 1]) { g.strokeStyle = 'rgba(120,150,200,.07)'; g.beginPath(); g.moveTo(0, yAt(z)); g.lineTo(W, yAt(z)); g.stroke(); }
  // depth shading behind each army, from book liquidity (Newhedge-style buffer)
  if (!S.book) return;
  const side = (arr, rgb) => {
    const max = Math.max(1, ...arr.map(([, u]) => u));
    for (const [p, u] of arr) {
      const a = Math.min(0.22, 0.25 * Math.sqrt(u / max));
      const b = S.book.bucketUsd;
      g.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
      g.beginPath(); g.moveTo(xAt(p, 0), yAt(0)); g.lineTo(xAt(p + b, 0), yAt(0)); g.lineTo(xAt(p + b, 0.5), yAt(0.5)); g.lineTo(xAt(p, 0.5), yAt(0.5)); g.closePath(); g.fill();
    }
  };
  side(S.book.bids, '47,191,143'); side(S.book.asks, '229,72,77');
}

// MODELED liquidation zones from the daily server analysis (estimate, not observed)
function drawZones() {
  const lv = S.server?.map?.levels;
  if (!lv) return;
  for (const l of lv) {
    const tags = (l.tags || []).join(' ');
    const isL = /long-liquidation/.test(tags), isS = /short-squeeze/.test(tags);
    if (!isL && !isS) continue;
    const x0 = xAt(l.level - 2500, 0), x1 = xAt(l.level + 2500, 0);
    if (x1 < -50 || x0 > W + 50) continue;
    g.fillStyle = isL ? 'rgba(229,72,77,.05)' : 'rgba(47,191,143,.05)';
    g.fillRect(x0, yAt(0.02) - 2, x1 - x0, 4);
    g.font = '500 10px "IBM Plex Mono", monospace'; g.textAlign = 'center';
    g.fillStyle = 'rgba(200,210,225,.45)';
    g.fillText(`MODELLED ${isL ? 'LONG' : 'SHORT'}-LIQ ZONE ${Math.round(l.level / 1000)}K`, clamp((x0 + x1) / 2, 120, W - 120), yAt(0) + 2);
  }
}

function drawArmies(dt, m) {
  const B = S.book; if (!B) return;
  const all = [...B.bids, ...B.asks];
  const total = all.reduce((s, [, u]) => s + u, 0);
  const budget = W < 640 ? 230 : W < 1100 ? 420 : 620;
  const unitUsd = Math.max(15000, total / budget);
  // walls use the same $50 bands as the Buy/Sell wall tiles
  const bands = (arr) => { const m = new Map(); for (const [p, u] of arr) { const k = Math.round(p / WALL_BAND) * WALL_BAND; m.set(k, (m.get(k) || 0) + u); } return [...m.entries()]; };
  const bandB = bands(B.bids), bandA = bands(B.asks);
  const sorted = [...bandB, ...bandA].map(([, u]) => u).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const wallMin = Math.max(median * WALL_MULT, WALL_MIN_USD);
  const seen = new Set();
  const draws = [];
  const champions = [];
  const baseH = clamp(Math.min(H * 0.075, W * 0.042), 14, 64);
  const ease = 1 - Math.exp(-dt / 350);
  const momentum = { bull: m.flowImb > 0.15, bear: m.flowImb < -0.15 };
  for (const [arr, species] of [[B.bids, 'bull'], [B.asks, 'bear']]) {
    for (const [p, u] of arr) {
      const key = species + p;
      seen.add(key);
      const target = Math.min(16, u / unitUsd);
      const cur = display.has(key) ? display.get(key) : 0;
      const n = cur + (target - cur) * ease;
      display.set(key, n);
      const cx = p + B.bucketUsd / 2;
      if (Math.abs(cx - S.cam) / S.cam > S.rangePct / 100 * 1.15) continue;
      const count = Math.ceil(n);
      for (let k = 0; k < count; k++) {
        const frac = k === count - 1 ? n - Math.floor(n) || 1 : 1;
        const z = 0.05 + k * 0.058 + hash(p * 7 + k) * 0.03;
        const jx = (hash(p + k * 3.1) - 0.5) * B.bucketUsd * 0.9;
        draws.push({ species, x: cx + jx, z, alpha: clamp(frac, 0.15, 1), size: baseH * (0.78 + 0.35 * hash(p * 1.3 + k)), phase: hash(p + k) * 6.28, march: momentum[species] });
      }
    }
  }
  for (const k of display.keys()) if (!seen.has(k)) {
    const v = display.get(k) * (1 - ease);
    if (v < 0.05) {
      display.delete(k);
    } else {
      display.set(k, v);
      // a band that vanished on the losing side of the moving front = routed units
      const p = +k.slice(4), species = k.slice(0, 4);
      if (S.mid && ((species === 'bear' && p < S.mid) || (species === 'bull' && p > S.mid)) && routed.length < 220 && Math.random() < 0.08) routed.push({ species, x: p, z: Math.random() * 0.4, born: performance.now() });
    }
  }
  for (const [arr, species] of [[bandB, 'bull'], [bandA, 'bear']]) for (const [p, u] of arr) if (u >= wallMin && Math.abs(p - S.cam) / S.cam <= S.rangePct / 100) champions.push({ species, x: p, usd: u, p });
  // champions: the walls, drawn in the front rank
  champions.sort((a, b) => b.usd - a.usd);
  placedLabels.length = 0;
  for (const c of champions.slice(0, W < 640 ? 2 : 4)) draws.push({ species: c.species, x: c.x, z: 0.01, alpha: 1, size: baseH * clamp(1.5 + Math.log10(c.usd / wallMin + 1) * 1.6, 1.6, 2.8), champion: c, phase: 0, march: false });
  // far to near
  draws.sort((a, b) => b.z - a.z);
  const t = performance.now();
  for (const d of draws) {
    const sc = sAt(d.z);
    let x = xAt(d.x, d.z), y = yAt(d.z);
    // knock-back from nearby explosions
    for (const b of fx.list) if (b.kind === 'boom' && b.sx !== undefined) {
      const age = (t - b.born) / b.life; if (age > 0.4) continue;
      const dx = x - b.sx, dy = y - b.sy, dd = Math.hypot(dx, dy), r = b.r * 1.3;
      if (dd < r) { const f = (1 - dd / r) * (1 - age / 0.4) * 14; x += (dx / (dd || 1)) * f; y += (dy / (dd || 1)) * f * 0.5 - f * 0.6; }
    }
    const px = d.size * sc;
    const fr = reduced ? 0 : d.march ? Math.floor((gaitT / 140 + d.phase) % 4) : 0;
    const spr = sprites.get(d.species, fr, px, 1 - sc, !!d.champion);
    const bob = reduced ? 0 : Math.sin(t / 700 + d.phase) * 0.6 * sc;
    const w = spr.w * spr.scale, h = spr.h * spr.scale;
    g.globalAlpha = d.alpha * (0.55 + 0.45 * sc);
    if (d.species === 'bull') g.drawImage(spr.img, x - w * 0.62, y - h + 3 + bob, w, h);
    else { g.save(); g.translate(x + w * 0.62, y - h + 3 + bob); g.scale(-1, 1); g.drawImage(spr.img, 0, 0, w, h); g.restore(); }
    g.globalAlpha = 1;
    if (d.champion) label(d, x, y - h - 6);
  }
  // routed units: fade and sink where the front swept through
  for (let i = routed.length - 1; i >= 0; i--) {
    const r = routed[i], age = (t - r.born) / 1600;
    if (age > 1) { routed.splice(i, 1); continue; }
    const sc = sAt(r.z), spr = sprites.get(r.species, 0, 26 * sc, 1 - sc);
    g.globalAlpha = (1 - age) * 0.5;
    const x = xAt(r.x, r.z), y = yAt(r.z) + age * 8;
    g.drawImage(spr.img, x - spr.w * spr.scale / 2, y - spr.h * spr.scale, spr.w * spr.scale, spr.h * spr.scale);
    g.globalAlpha = 1;
  }
}
const placedLabels = [];
function label(d, x, y) {
  const c = d.champion;
  const txt = `${c.species === 'bull' ? 'BID WALL' : 'ASK WALL'}  ${fmtUsd(c.usd)}  @ ${Math.round(c.p).toLocaleString('en-US')}`;
  g.font = '600 10.5px "IBM Plex Mono", monospace';
  const tw = g.measureText(txt).width + 14;
  const lx = clamp(x - tw / 2, 6, W - tw - 6);
  let ly = Math.max(HZ() + 6, y - 22);
  // stack labels upward instead of overlapping
  for (let tries = 0; tries < 6 && placedLabels.some((r) => lx < r.x + r.w + 4 && lx + tw + 4 > r.x && ly < r.y + 20 && ly + 20 > r.y); tries++) ly -= 22;
  placedLabels.push({ x: lx, y: ly, w: tw });
  g.strokeStyle = c.species === 'bull' ? 'rgba(63,210,154,.6)' : 'rgba(232,86,91,.6)';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, ly + 18); g.stroke();
  g.fillStyle = 'rgba(6,12,22,.82)'; g.fillRect(lx, ly, tw, 18);
  g.strokeRect(lx + 0.5, ly + 0.5, tw - 1, 17);
  g.fillStyle = c.species === 'bull' ? '#8ff5cc' : '#ffb3a6'; g.textAlign = 'left';
  g.fillText(txt, lx + 7, ly + 12.5);
}

function drawFront(m, now) {
  const x0 = xAt(S.mid, 0), x1 = xAt(S.mid, 1);
  const y0 = yAt(0), y1 = yAt(1);
  const intensity = clamp((m.buy60 + m.sell60) / 2e7, 0.15, 1);
  // pressure glow either side of the line
  for (const [dir, rgb, w] of [[-1, '47,191,143', 0.5 + 0.5 * clamp(m.flowImb, 0, 1)], [1, '229,72,77', 0.5 + 0.5 * clamp(-m.flowImb, 0, 1)]]) {
    const gx = g.createLinearGradient(x0, 0, x0 + dir * 90 * w, 0);
    gx.addColorStop(0, `rgba(${rgb},${0.28 * intensity})`); gx.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gx;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x1 + dir * 30 * w, y1); g.lineTo(x0 + dir * 90 * w, y0); g.closePath(); g.fill();
  }
  g.strokeStyle = 'rgba(255,236,200,.85)'; g.lineWidth = 1.4;
  g.shadowColor = 'rgba(255,200,120,.9)'; g.shadowBlur = 12;
  g.beginPath(); g.moveTo(x0, y0 + 4); g.lineTo(x1, y1); g.stroke();
  g.shadowBlur = 0; g.lineWidth = 1;
  // sparks along the line proportional to traded volume
  if (!reduced) {
    const rate = clamp((m.buy60 + m.sell60) / 6e6, 0.2, 6);
    for (let i = 0; i < rate; i++) if (Math.random() < 0.6) {
      const z = Math.random(); const buy = Math.random() < (m.buy60 / ((m.buy60 + m.sell60) || 1));
      fx.parts.push({ x: xAt(S.mid, z), y: yAt(z) - Math.random() * 30 * sAt(z), vx: (buy ? 1 : -1) * (0.4 + Math.random()) * sAt(z), vy: -0.3 - Math.random() * 0.6, life: 500 + Math.random() * 500, born: now, c: buy ? '143,245,204' : '255,179,166', r: 1.2 * sAt(z) + 0.4 });
    }
  }
  // price tag on the line
  g.font = '600 12px "IBM Plex Mono", monospace'; g.textAlign = 'center';
  const t = fmtPx(S.mid);
  const tw = g.measureText(t).width + 16;
  g.fillStyle = 'rgba(255,236,200,.95)'; g.fillRect(x0 - tw / 2, y0 + 6, tw, 18);
  g.fillStyle = '#0a1220'; g.fillText(t, x0, y0 + 19);
}

function drawFx(now) {
  for (let i = fx.list.length - 1; i >= 0; i--) {
    const f = fx.list[i], age = (now - f.born) / f.life;
    if (age >= 1) { fx.list.splice(i, 1); continue; }
    if (f.kind === 'strike') drawStrike(f, age);
    else drawBoom(f, age, now);
  }
  g.globalCompositeOperation = 'lighter';
  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const p = fx.parts[i], a = (now - p.born) / p.life;
    if (a >= 1) { fx.parts.splice(i, 1); continue; }
    p.x += p.vx; p.y += p.vy; p.vy += 0.03;
    g.fillStyle = `rgba(${p.c},${(1 - a) * 0.9})`;
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  if (fx.parts.length > 900) fx.parts.splice(0, fx.parts.length - 900);
}
function drawStrike(f, age) {
  const e = f.e, buy = e.side === 'buy';
  const z = 0.12 + hash(e.t % 997) * 0.35;
  const tx = xAt(S.mid, z), ty = yAt(z) - 18 * sAt(z);
  const sx = tx + (buy ? -1 : 1) * W * 0.32, sy = yAt(z) - H * 0.28;
  const k = clamp(age / 0.35, 0, 1);
  const cx = (sx + tx) / 2, cy = Math.min(sy, ty) - H * 0.12;
  const pt = (u) => [(1 - u) ** 2 * sx + 2 * (1 - u) * u * cx + u * u * tx, (1 - u) ** 2 * sy + 2 * (1 - u) * u * cy + u * u * ty];
  const rgb = buy ? '63,210,154' : '232,86,91';
  const wgt = clamp(Math.log10(e.usd / 5e4), 0.5, 3.5);
  if (k < 1) {
    g.strokeStyle = `rgba(${rgb},.85)`; g.lineWidth = wgt; g.lineCap = 'round';
    g.beginPath(); const a = pt(Math.max(0, k - 0.25)); g.moveTo(a[0], a[1]);
    for (let u = Math.max(0, k - 0.25); u <= k; u += 0.02) { const q = pt(u); g.lineTo(q[0], q[1]); }
    g.stroke(); g.lineWidth = 1;
  } else {
    const a2 = (age - 0.35) / 0.65, r = (10 + wgt * 12) * a2;
    g.strokeStyle = `rgba(${rgb},${(1 - a2) * 0.9})`; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(tx, ty, r, r * 0.45, 0, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1;
    if (a2 < 0.7) {
      g.font = '600 10.5px "IBM Plex Mono", monospace'; g.textAlign = 'center';
      g.fillStyle = `rgba(${buy ? '143,245,204' : '255,179,166'},${1 - a2 / 0.7})`;
      g.fillText(`${fmtUsd(e.usd)} ${buy ? 'BUY' : 'SELL'} · ${e.venue}`, tx, ty - 16 - a2 * 14);
    }
  }
}
function drawBoom(f, age, now) {
  const e = f.e, long = e.side === 'long';
  if (f.sx === undefined) {
    const z = 0.08 + hash(e.t % 1013) * 0.3;
    const off = (long ? -1 : 1) * (12 + hash(e.t % 7919) * 40);
    f.sx = xAt(S.mid, z) + off; f.sy = yAt(z) - 10 * sAt(z);
    f.r = clamp(18 + Math.sqrt(e.usd) / 7, 22, Math.min(W, H) * 0.3) * sAt(z) ** 0.4;
    if (!reduced) for (let i = 0; i < clamp(e.usd / 25000, 8, 90); i++) {
      const a = Math.random() * Math.PI * 2, v = (0.6 + Math.random() * 2.6) * (f.r / 40);
      fx.parts.push({ x: f.sx, y: f.sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 1.2, life: 700 + Math.random() * 900, born: now, c: Math.random() < 0.5 ? '255,190,110' : long ? '63,210,154' : '232,86,91', r: 0.8 + Math.random() * 1.8 });
    }
  }
  const { sx, sy, r } = f;
  // fireball
  const fa = clamp(1 - age / 0.55, 0, 1);
  if (fa > 0) {
    const fr = r * (0.35 + 0.65 * Math.min(1, age / 0.1)) * (1 + 0.15 * Math.sin(age * 40));
    // ground light pool
    const gl = g.createRadialGradient(sx, sy + fr * 0.4, 0, sx, sy + fr * 0.4, fr * 2.2);
    gl.addColorStop(0, `rgba(255,170,80,${0.35 * fa})`); gl.addColorStop(1, 'rgba(255,170,80,0)');
    g.globalCompositeOperation = 'lighter'; g.fillStyle = gl; g.beginPath(); g.ellipse(sx, sy + fr * 0.4, fr * 2.2, fr * 0.7, 0, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'source-over';
    const gr = g.createRadialGradient(sx, sy, 0, sx, sy, fr);
    gr.addColorStop(0, `rgba(255,248,230,${fa})`); gr.addColorStop(0.3, `rgba(255,190,100,${fa * 0.9})`); gr.addColorStop(0.65, `rgba(220,90,40,${fa * 0.5})`); gr.addColorStop(1, 'rgba(120,30,20,0)');
    g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, fr, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'source-over';
  }
  // shockwave in the colour of the side that gained (long liq = sellers' win)
  const rgb = long ? '232,86,91' : '63,210,154';
  const ra = r * (0.4 + 2.2 * age);
  g.strokeStyle = `rgba(${rgb},${(1 - age) * 0.8})`; g.lineWidth = 2 * (1 - age) + 0.5;
  g.beginPath(); g.ellipse(sx, sy + r * 0.2, ra, ra * 0.32, 0, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1;
  // smoke
  if (age > 0.15) { g.fillStyle = `rgba(30,38,52,${0.35 * (1 - age)})`; g.beginPath(); g.arc(sx, sy - r * 0.6 * age, r * (0.6 + age), 0, Math.PI * 2); g.fill(); }
  if (age < 0.75) {
    g.font = `600 ${e.usd >= 1e6 ? 13 : 11}px "IBM Plex Mono", monospace`; g.textAlign = 'center';
    g.fillStyle = `rgba(255,226,190,${1 - age / 0.75})`;
    const txt = `${long ? 'LONG' : 'SHORT'} LIQUIDATED  ${fmtUsd(e.usd)}  · ${e.venue}`;
    const ly = Math.max(HZ() + 20, sy - Math.min(r, 70) - 12);
    const tw = g.measureText(txt).width + 14;
    g.fillStyle = `rgba(6,12,22,${0.8 * (1 - age / 0.75)})`; g.fillRect(sx - tw / 2, ly - 13, tw, 18);
    g.fillStyle = `rgba(255,226,190,${1 - age / 0.75})`;
    g.fillText(txt, sx, ly);
  }
  // large liquidations flash the frame edge
  if (e.usd >= 1e6 && age < 0.25 && !reduced) { g.fillStyle = `rgba(255,170,90,${0.08 * (1 - age / 0.25)})`; g.fillRect(0, 0, W, H); }
}
function drawAxis() {
  const step = gridStep(), y = GB() + 2;
  g.font = '500 10.5px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.fillStyle = 'rgba(160,175,200,.7)';
  const lo = S.cam * (1 - S.rangePct / 100 * 1.1), hi = S.cam * (1 + S.rangePct / 100 * 1.1);
  for (let p = Math.ceil(lo / (step * 2)) * step * 2; p <= hi; p += step * 2) {
    const x = xAt(p, 0); if (x < 30 || x > W - 30) continue;
    if (Math.abs(x - xAt(S.mid, 0)) < 52) continue;
    if (W < 640 && (p / (step * 2)) % 2 !== 0) continue;
    g.fillText(p.toLocaleString('en-US'), x, y + 22);
    g.fillStyle = 'rgba(160,175,200,.35)'; g.fillRect(x - 0.5, y + 4, 1, 6); g.fillStyle = 'rgba(160,175,200,.7)';
  }
  if (W >= 640) {
    g.textAlign = 'left'; g.fillStyle = 'rgba(63,210,154,.75)'; g.fillText('◀ BIDS · BULLS', 12, y + 22);
    g.textAlign = 'right'; g.fillStyle = 'rgba(232,86,91,.75)'; g.fillText('BEARS · ASKS ▶', W - 12, y + 22);
  }
}
function drawVignette() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const v = g.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  if (grain) { g.fillStyle = g.createPattern(grain, 'repeat'); g.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------- HUD + data layer
const tapeEl = $('#tape');
function tape(e) {
  const li = document.createElement('li');
  const time = new Date(e.t).toISOString().slice(11, 19);
  if (e.type === 'liq') { li.className = e.side === 'long' ? 'ev bear' : 'ev bull'; li.innerHTML = `<span class="tm">${time}</span><b>${e.side === 'long' ? 'Long' : 'Short'} liquidated</b> <span class="amt">${fmtUsd(e.usd)}</span> <span class="dim">@ ${fmtPx(e.px)} · ${esc(e.venue)}</span>`; }
  else { li.className = e.side === 'buy' ? 'ev bull' : 'ev bear'; li.innerHTML = `<span class="tm">${time}</span><b>Large ${e.side === 'buy' ? 'buy' : 'sell'}</b> <span class="amt">${fmtUsd(e.usd)}</span> <span class="dim">@ ${fmtPx(e.px)} · ${esc(e.venue)}</span>`; }
  tapeEl.prepend(li);
  while (tapeEl.children.length > 60) tapeEl.lastChild.remove();
}
function note(t) { const n = $('#note'); n.textContent = t; n.hidden = !t; }
function renderMode() {
  const b = $('#mode');
  const rec = S.replay?.data?.recordedAt;
  b.className = 'mode ' + S.mode;
  b.textContent = S.mode === 'live' ? 'LIVE' : S.mode === 'replay' ? 'REPLAY' : S.mode === 'none' ? 'NO DATA' : 'CONNECTING';
  $('#mode-sub').textContent = S.mode === 'replay' && rec ? `Recorded ${new Date(rec).toUTCString().slice(5, 22)} UTC · real exchange data · ${S.speed}×` : S.mode === 'live' ? 'Streaming from exchange WebSockets' : '';
  $('#btn-live').setAttribute('aria-pressed', String(S.mode === 'live' || (S.mode === 'connecting' && !!live)));
  $('#btn-replay').setAttribute('aria-pressed', String(S.mode === 'replay'));
  document.querySelectorAll('[data-speed]').forEach((x) => { x.hidden = S.mode !== 'replay'; x.setAttribute('aria-pressed', String(+x.dataset.speed === S.speed)); });
}
function renderVenues() {
  $('#venues').innerHTML = Object.entries(S.venues).map(([v, s]) => `<span class="vd ${esc(s.state)}" title="${esc(s.note || s.state)}"><i></i>${esc(v)}</span>`).join('');
}
function tile(id, value, sub, src) {
  const el = document.getElementById(id); if (!el) return;
  el.querySelector('.v').textContent = value;
  el.querySelector('.s').textContent = sub;
  el.querySelector('.src').textContent = src;
}
function renderData() {
  prune();
  const m = metrics();
  const live = S.mode === 'live';
  const feedAge = S.lastBookAt ? (Date.now() - S.lastBookAt) / 1000 : null;
  if (live && feedAge > 15) note('Order-book feed has stalled for ' + Math.round(feedAge) + 's — values may be stale.'); else if (live) note('');
  const v = S.book?.venues?.length || 0;
  const srcBook = S.mode === 'replay' ? `Recorded order books · ${v} venues` : `Live order books · ${(S.book?.venues || []).join(', ') || '—'}`;
  // hero HUD
  $('#hud-price').textContent = S.mid ? '$' + fmtPx(S.mid) : '—';
  const ch = $('#hud-ch'); ch.textContent = fmtPct(m.ch24); ch.className = m.ch24 > 0 ? 'up' : m.ch24 < 0 ? 'down' : '';
  const buyShare = m.buy60 + m.sell60 ? m.buy60 / (m.buy60 + m.sell60) : 0.5;
  $('#pbar-b').style.width = (buyShare * 100).toFixed(1) + '%';
  $('#pbar-txt').textContent = m.buy60 + m.sell60 ? `Buyers ${Math.round(buyShare * 100)}% · ${fmtUsd(m.buy60)}  |  Sellers ${Math.round((1 - buyShare) * 100)}% · ${fmtUsd(m.sell60)}` : 'Waiting for trades…';
  // OBSERVED
  tile('t-price', S.mid ? '$' + fmtPx(S.mid) : '—', `Median of venue mid-prices`, srcBook);
  tile('t-ch', fmtPct(m.ch24), m.ch24Venue ? `${m.ch24Venue} 24h ticker` : 'Waiting for ticker', m.ch24Venue ? `${S.mode === 'replay' ? 'Recorded' : 'Live'} ticker` : '');
  tile('t-bwall', m.buyWall ? fmtUsd(m.buyWall[1]) : '—', m.buyWall ? `Largest $50 bid band within 1% · @ ${m.buyWall[0].toLocaleString('en-US')}` : '—', srcBook);
  tile('t-swall', m.sellWall ? fmtUsd(m.sellWall[1]) : '—', m.sellWall ? `Largest $50 ask band within 1% · @ ${m.sellWall[0].toLocaleString('en-US')}` : '—', srcBook);
  tile('t-imb', m.imb05 !== undefined ? fmtPct(m.imb05 * 100, 1) : '—', m.imb05 !== undefined ? `±0.5%: bids ${fmtUsd(m.bid05)} / asks ${fmtUsd(m.ask05)} · ±1%: ${fmtPct(m.imb1 * 100, 1)}` : '—', srcBook + ' · + = more bids');
  const liqVenues = ['OKX', 'Deribit', 'Binance futures'].filter((v) => ['live', 'recorded'].includes(S.venues[v]?.state)).map((v) => v.replace(' futures', '')).join(', ') || 'none connected';
  const sess = S.sessionStart ? `since ${new Date(S.sessionStart).toISOString().slice(11, 16)} UTC` : '';
  tile('t-lliq', fmtUsd(m.longLiq1h), `Last hour · ${fmtUsd(m.longLiqS)} ${sess} · longs forced to sell`, `Liquidation feeds: ${liqVenues} (not market-wide)`);
  tile('t-sliq', fmtUsd(m.shortLiq1h), `Last hour · ${fmtUsd(m.shortLiqS)} ${sess} · shorts forced to buy`, `Liquidation feeds: ${liqVenues} (not market-wide)`);
  tile('t-big', `${m.bigCount}`, `≥ ${fmtUsd(S.bigTrade)} in 15 min · buys ${fmtUsd(m.bigBuy)} / sells ${fmtUsd(m.bigSell)}${m.largest ? ` · largest ${fmtUsd(m.largest.usd)} ${m.largest.side}` : ''}`, 'Trades: Coinbase, Kraken, OKX, Binance spot + OKX perp');
  const fr = S.funding?.rate8h ?? S.server?.metrics?.derivs?.funding8h ?? null;
  tile('t-fund', fr !== null ? `${(fr * 100).toFixed(4)}%` : '—', fr !== null ? `per 8h · ${(fr * 3 * 365 * 100).toFixed(1)}% annualised` : '—', S.funding ? `OKX BTC-USDT perp · ${S.mode === 'replay' ? 'recorded' : 'live'} ${ago(S.funding.t)}` : S.server ? `OI-weighted, last server run ${String(S.server.dataThrough).slice(0, 16)} UTC` : '—');
  const agg = S.server?.metrics?.derivs;
  tile('t-oi', S.oi ? fmtUsd(S.oi.usd) : agg ? fmtUsd(agg.totalOi) : '—', `${S.oi ? 'OKX BTC-USDT perp (live)' : ''}${S.oi && agg ? ' · ' : ''}${agg ? `5 venues ${fmtUsd(agg.totalOi)} at last server run` : ''}`, S.oi ? `OKX open-interest channel · ${ago(S.oi.t)}` : agg ? `Server run ${String(S.server.dataThrough).slice(0, 16)} UTC` : '—');
  tile('t-vol', m.vol24 ? fmtUsd(m.vol24) : '—', `24h spot volume · ${m.volVenues.join(', ') || '—'} · last 60s ${fmtUsd(m.buy60 + m.sell60)}`, `${S.mode === 'replay' ? 'Recorded' : 'Live'} tickers (venue sum, not market-wide)`);
  // MODELED
  tile('m-press', `${m.pressure > 0 ? '+' : ''}${m.pressure}`, m.pressure > 20 ? 'Buyers applying pressure' : m.pressure < -20 ? 'Sellers applying pressure' : 'Balanced', '0.5×taker-flow imbalance (60s) + 0.3×book imbalance (±0.5%) + 0.2×liquidation imbalance (15m)');
  const bullU = (S.book?.bids || []).reduce((s, [, u]) => s + u, 0), bearU = (S.book?.asks || []).reduce((s, [, u]) => s + u, 0);
  tile('m-army', bullU + bearU ? `${Math.round((bullU / (bullU + bearU)) * 100)} : ${Math.round((bearU / (bullU + bearU)) * 100)}` : '—', `Bull vs bear liquidity within ±2% (${fmtUsd(bullU)} / ${fmtUsd(bearU)})`, 'Unit counts ∝ displayed book liquidity per price band; champions = $50 bands ≥ 4× the median band and ≥ $2M');
  const lv = S.server?.map?.levels || [];
  const below = lv.filter((l) => S.mid && l.level < S.mid && (l.tags || []).some((t) => /long-liquidation/.test(t))).sort((a, b) => b.level - a.level)[0];
  const above = lv.filter((l) => S.mid && l.level > S.mid && (l.tags || []).some((t) => /short-squeeze/.test(t))).sort((a, b) => a.level - b.level)[0];
  tile('m-zones', `${below ? Math.round(below.level / 1000) + 'K' : '—'} / ${above ? Math.round(above.level / 1000) + 'K' : '—'}`, `Nearest modelled long-liq zone below / short-squeeze zone above${below ? ` · ≈${fmtUsd(below.liqLong)} longs` : ''}${above ? ` · ≈${fmtUsd(above.liqShort)} shorts` : ''}`, S.server ? `Model estimate from OI build-up, server run ${String(S.server.dataThrough).slice(0, 16)} UTC` : 'Server analysis unavailable');
  tile('m-mom', fmtPct(m.mom5, 3), m.mom5 === null ? 'Needs 5 minutes of data' : m.mom5 > 0 ? 'Bulls advancing over the last 5 minutes' : m.mom5 < 0 ? 'Bears advancing over the last 5 minutes' : 'Front line holding', 'Mid-price change over 5 minutes');
}

// ---------------------------------------------------------------- controls
document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { S.rangePct = +b.dataset.range; document.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.range === S.rangePct))); }));
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { S.speed = +b.dataset.speed; renderMode(); }));
$('#big').addEventListener('change', (e) => { S.bigTrade = +e.target.value; });
$('#btn-live').addEventListener('click', () => { note(''); startLive(); });
$('#btn-replay').addEventListener('click', () => { note(''); startReplay(); });
$('#btn-pause').addEventListener('click', (e) => { S.paused = !S.paused; e.currentTarget.setAttribute('aria-pressed', String(S.paused)); e.currentTarget.textContent = S.paused ? 'Resume' : 'Pause'; });
$('#btn-full').addEventListener('click', () => { const st = $('#stage'); (document.fullscreenElement ? document.exitFullscreen() : st.requestFullscreen?.())?.catch?.(() => {}); });

// ---------------------------------------------------------------- boot
(async () => {
  for (const u of ['../data/latest.json', 'data/latest.json']) { try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) { S.server = await r.json(); break; } } catch {} }
})();
resize();
requestAnimationFrame(frame);
setInterval(renderData, 500);
if (window.BMI_PREVIEW || new URLSearchParams(location.search).has('replay')) { if (window.BMI_PREVIEW) note('Preview: this page cannot open live exchange connections, so it replays real data recorded from the exchanges. On the site it streams live.'); startReplay(); }
else startLive();
