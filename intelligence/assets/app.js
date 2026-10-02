// Bitcoin Market Intelligence — page controller.
// Renders the agent's latest analysis and can regenerate it in the browser
// using the same engine the scheduled agent runs.

import { analyze } from '../engine/analyze.js';
import { collectAll, mergeWithPrevious } from '../engine/collect.js';
import { morningReport } from '../engine/report.js';
import { fmtUsd, fmtUsdSigned, fmtPrice, fmtPct, fmtNum, fmtK, ordinal } from '../engine/util.js';

const REPO = 'bitcoincustodystandard/bitcoincustodystandard.github.io';
const WORKFLOW = 'market-intel.yml';
const SERVER_ONLY = ['farside', 'fred', 'yahoo', 'cftc_cot'];
const state = { a: null, rows: [], runs: [], index: null, snapshot: null, range: 90 };
const $ = (s, r = document) => r.querySelector(s);

// ---------- safe templating ----------
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ser = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(ser).join('') : v === null || v === undefined || v === false ? '' : esc(v));
const h = (strings, ...vals) => raw(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? ser(vals[i]) : ''), ''));
const safeUrl = (u) => (u && /^https:\/\//.test(u) ? u : null);

// ---------- formatting ----------
const tzFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const fmtTime = (t) => { if (!t) return 'n/a'; const d = new Date(t.length === 10 ? t + 'T00:00:00Z' : t); return isNaN(d) ? String(t) : t.length === 10 ? t : tzFmt.format(d); };
const ageH = (t) => (t ? (Date.now() - new Date(t)) / 3600e3 : null);
const cls = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
function dirClass(d = '') {
  d = d.toLowerCase();
  if (/bullish|stabilising|constructive|falling \(/.test(d)) return 'bull';
  if (/bearish|fragility rising|amplifier/.test(d)) return 'bear';
  return 'neu';
}
const chip = (txt, c) => h`<span class="chip ${c}">${txt}</span>`;
const dirChip = (d) => chip(d, dirClass(d));

function srcLine(ids) {
  const a = state.a;
  const parts = [];
  for (const id of [].concat(ids)) {
    const q = a.quality.find((x) => x.id === id);
    if (!q) continue;
    parts.push(h`${q.name} · ${fmtTime(q.asOf || q.fetchedAt)} · ${q.frequency || ''}${q.status !== 'ok' ? raw(' ' + ser(chip(q.status === 'server-only' ? 'server value' : q.status, q.status === 'error' ? 'err' : 'stale'))) : ''}`);
  }
  return parts.length ? raw(parts.map((p) => p.s).join('<br>')) : h`<span class="dim">source unavailable</span>`;
}
const isStale = (ids) => [].concat(ids).some((id) => { const q = state.a.quality.find((x) => x.id === id); return q && q.status !== 'ok'; });

// ---------- minimal markdown (input is escaped first) ----------
function md(src) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = String(src || '').split('\n');
  let out = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { const n = Math.min(m[1].length, 3); out += `<h${n}>${inline(m[2])}</h${n}>`; i++; continue; }
    if (/^---+\s*$/.test(l)) { out += '<hr>'; i++; continue; }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|[\s:|-]+\|?$/.test(r)));
      out += '<table><thead><tr>' + cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' + body.slice(1).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }
    if (/^>\s?/.test(l)) { let b = ''; while (i < lines.length && /^>\s?/.test(lines[i])) { b += lines[i].replace(/^>\s?/, '') + ' '; i++; } out += `<blockquote>${inline(b)}</blockquote>`; continue; }
    if (/^\s*[-*]\s+/.test(l)) { out += '<ul>'; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`; i++; } out += '</ul>'; continue; }
    if (/^\s*\d+\.\s+/.test(l)) { out += '<ol>'; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`; i++; } out += '</ol>'; continue; }
    let p = '';
    while (i < lines.length && lines[i].trim() && !/^(#|\||>|\s*[-*]\s|\s*\d+\.\s|---)/.test(lines[i])) { p += lines[i].replace(/\s+$/, '') + ' '; i++; }
    out += `<p>${inline(p.trim())}</p>`;
  }
  return raw(out);
}

// ---------- charts (inline SVG, single axis, hover layer) ----------
function niceTicks(min, max, n = 4) {
  if (min === max) { const d = Math.abs(min) * 0.05 || 1; min -= d; max += d; }
  const step0 = (max - min) / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
  return t;
}
const BIG = { w: 600, h: 200, pad: { l: 56, r: 14, t: 10, b: 24 }, axes: true };
const SPARK = { w: 300, h: 64, pad: { l: 2, r: 6, t: 6, b: 4 }, axes: false };
const xLabel = (d) => (d.length > 10 ? `${d.slice(5, 10)} ${d.slice(11, 16)}` : d.slice(2));
const tipLabel = (d) => (d.length > 10 ? fmtTime(d) : d);
function emptySvg(o, msg) {
  return `<svg viewBox="0 0 ${o.w} ${o.h}" data-w="${o.w}" data-h="${o.h}" role="img"><text class="empty" x="${o.w / 2}" y="${o.h / 2 + 4}" text-anchor="middle">${esc(msg)}</text></svg>`;
}
function lineSvg(pts, fmt, o = BIG, emptyMsg = 'Not enough history yet', fmtTip = fmt) {
  if (!pts || pts.length < 2) return emptySvg(o, pts?.length === 1 ? `1 observation so far (${fmtTip(pts[0][1])}) — ${emptyMsg}` : emptyMsg);
  const { w: W, h: H, pad: PAD } = o;
  const xs = pts.map((p) => new Date(p[0].length > 10 ? p[0] : p[0] + 'T00:00:00Z').getTime()), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = o.axes ? ticks[0] : Math.min(...ys), y1 = o.axes ? ticks.at(-1) : Math.max(...ys);
  const X = (x) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const Y = (y) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const area = `${path}L${X(xs.at(-1)).toFixed(1)},${H - PAD.b}L${X(xs[0]).toFixed(1)},${H - PAD.b}Z`;
  const grid = o.axes ? ticks.map((t) => `<line class="gridl" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${PAD.l - 6}" y="${Y(t) + 3}" text-anchor="end">${esc(fmt(t))}</text>`).join('') : '';
  const xl = o.axes ? [0, Math.floor(pts.length / 2), pts.length - 1].map((i) => `<text class="axis" x="${X(xs[i])}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${esc(xLabel(pts[i][0]))}</text>`).join('') : '';
  const data = esc(JSON.stringify(pts.map((p, i) => [+X(xs[i]).toFixed(1), +Y(p[1]).toFixed(1), tipLabel(p[0]), fmtTip(p[1])])));
  const end = `<circle class="enddot" cx="${X(xs.at(-1))}" cy="${Y(ys.at(-1))}" r="${o.axes ? 3.5 : 3}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" data-w="${W}" data-h="${H}" data-line="${data}" role="img" aria-label="line chart">${grid}${xl}<path class="area" d="${area}"/><path class="ln" d="${path}"/>${end}<line class="xh" y1="${PAD.t}" y2="${H - PAD.b}" style="display:none"/><circle class="dot" r="4" style="display:none"/></svg>`;
}
function barsSvg(pts, fmt, o = BIG, emptyMsg = 'No history yet', fmtTip = fmt) {
  if (!pts || pts.length < 2) return emptySvg(o, emptyMsg);
  const { w: W, h: H, pad: PAD } = o;
  const ys = pts.map((p) => p[1]);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
  const y0 = ticks[0], y1 = ticks.at(-1);
  const Y = (y) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const bw = (W - PAD.l - PAD.r) / pts.length;
  const grid = ticks.map((t) => (t === 0 || o.axes ? `<line class="${t === 0 ? 'zero' : 'gridl'}" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(t)}" y2="${Y(t)}"/>` : '') + (o.axes ? `<text class="axis" x="${PAD.l - 6}" y="${Y(t) + 3}" text-anchor="end">${esc(fmt(t))}</text>` : '')).join('');
  const bars = pts.map(([d, v], i) => {
    const x = PAD.l + i * bw + Math.min(1, bw * 0.15), w = Math.max(1, bw - Math.min(2, bw * 0.3));
    const y = v >= 0 ? Y(v) : Y(0), hh = Math.max(1, Math.abs(Y(v) - Y(0)));
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="${Math.min(2, w / 2)}" fill="var(${v >= 0 ? '--series-pos' : '--series-neg'})" data-tip="${esc(tipLabel(d) + '|' + fmtTip(v))}"/>`;
  }).join('');
  const xl = o.axes ? [0, pts.length - 1].map((i) => `<text class="axis" x="${PAD.l + i * bw + (i ? bw : 0)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${esc(xLabel(pts[i][0]))}</text>`).join('') : '';
  return `<svg viewBox="0 0 ${W} ${H}" data-w="${W}" data-h="${H}" role="img" aria-label="bar chart">${grid}${bars}${xl}</svg>`;
}
function wireChart(c) {
  const svg = c.querySelector('svg');
  if (!svg) return;
  const W = +svg.dataset.w, H = +svg.dataset.h;
  let tip = c.querySelector('.tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.style.display = 'none'; c.appendChild(tip); }
  const show = (x, y, d, v) => {
    tip.replaceChildren();
    const b = document.createElement('b'); b.textContent = v; const s = document.createElement('span'); s.textContent = d;
    tip.append(b, s); tip.style.display = 'block';
    const r = svg.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const px = (x / W) * r.width + (r.left - cr.left), py = (y / H) * r.height + (r.top - cr.top);
    tip.style.left = Math.max(4, Math.min(px + 10, cr.width - tip.offsetWidth - 4)) + 'px'; tip.style.top = Math.max(py - 44, -6) + 'px';
  };
  if (svg.dataset.line) {
    const pts = JSON.parse(svg.dataset.line);
    const xh = svg.querySelector('.xh'), dot = svg.querySelector('.dot');
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W;
      let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
      xh.setAttribute('x1', best[0]); xh.setAttribute('x2', best[0]); xh.style.display = '';
      dot.setAttribute('cx', best[0]); dot.setAttribute('cy', best[1]); dot.style.display = '';
      show(best[0], best[1], best[2], best[3]);
    });
    svg.addEventListener('pointerleave', () => { xh.style.display = 'none'; dot.style.display = 'none'; tip.style.display = 'none'; });
  } else {
    svg.querySelectorAll('rect[data-tip]').forEach((rc) => {
      rc.addEventListener('pointerenter', () => { const [d, v] = rc.dataset.tip.split('|'); rc.style.opacity = 0.7; show(+rc.getAttribute('x'), +rc.getAttribute('y'), d, v); });
      rc.addEventListener('pointerleave', () => { rc.style.opacity = ''; tip.style.display = 'none'; });
    });
  }
}

// Chart registry: every chart on the page is declared once here and drawn into
// <div data-chart="key"> (full size) or <div data-spark="key"> (tile size).
const cutDate = () => new Date(Date.now() - state.range * 864e5).toISOString().slice(0, 10);
const fromRows = (k) => { const c = cutDate(); return state.rows.filter((r) => r.date >= c && r[k] !== null && r[k] !== undefined).map((r) => [r.date, r[k]]); };
// Only runs measured on the same venue set as the latest are plotted together (no silent methodology mixing).
const fromRuns = (k, setKey) => { const c = cutDate(); const runs = state.runs || []; const latest = setKey ? runs.at(-1)?.[setKey] : null; return runs.filter((r) => r.t.slice(0, 10) >= c && r[k] !== null && r[k] !== undefined && (!setKey || r[setKey] === latest)).map((r) => [r.t, r[k]]); };
const etfPts = () => { const c = cutDate(); const m = new Map(); for (const r of state.rows) if (r.etfDate && r.etfDate >= c && r.etfLast !== null) m.set(r.etfDate, r.etfLast); return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)); };
const RUNS_MSG = 'history builds with every agent run (started Oct 1, 2026)';
const CHARTS = {
  price: { t: 'BTC price', s: 'daily close · CoinGecko', pts: () => fromRows('price'), f: (v) => fmtPrice(v), ft: (v) => fmtK(v) },
  depth: { t: '±1% order-book depth', s: 'per run · aggregate of 5 venues', pts: () => fromRuns('depth1', 'depthVenues'), f: (v) => fmtUsd(v, 1), ft: (v) => fmtUsd(v, 0), empty: RUNS_MSG },
  etf: { t: 'US spot ETF net flows', s: 'daily · Farside', kind: 'bars', pts: etfPts, f: (v) => fmtUsdSigned(v * 1e6), ft: (v) => fmtUsd(v * 1e6, 0), legend: true, empty: 'flow history builds daily (started Sep 2026)' },
  oi: { t: 'Open interest — OKX', s: 'daily · consistent single-venue series', pts: () => fromRows('oiOkx'), f: (v) => fmtUsd(v, 2), ft: (v) => fmtUsd(v, 1) },
  oiAgg: { t: 'Open interest — 5 major venues', s: 'per run · OKX, Binance, Bybit, Deribit, Hyperliquid', pts: () => fromRuns('oiTotal', 'oiCoverage'), f: (v) => fmtUsd(v, 2), ft: (v) => fmtUsd(v, 1), empty: RUNS_MSG },
  funding: { t: 'Perpetual funding (annualised)', s: 'daily avg · OKX BTC-USDT', pts: () => fromRows('fundingAnn'), f: (v) => fmtNum(v, 1) + '%', ft: (v) => fmtNum(v, 0) + '%' },
  premium: { t: 'Coinbase premium vs offshore', s: 'per run · US spot demand proxy', pts: () => fromRuns('cbPremium'), f: (v) => fmtPct(v, 3), ft: (v) => fmtNum(v, 2) + '%', empty: RUNS_MSG },
  dvol: { t: 'Implied volatility (DVOL)', s: 'daily · Deribit 30-day', pts: () => fromRows('dvol'), f: (v) => fmtNum(v, 1), ft: (v) => fmtNum(v, 0) },
  netliq: { t: 'US net liquidity (Fed − TGA − RRP)', s: 'weekly · FRED', pts: () => fromRows('netLiq'), f: (v) => fmtUsd(v * 1e9, 2), ft: (v) => fmtUsd(v * 1e9, 1) },
  real10y: { t: '10-year real yield', s: 'daily · FRED (TIPS)', pts: () => fromRows('real10y'), f: (v) => fmtNum(v, 2) + '%', ft: (v) => fmtNum(v, 1) + '%' },
  dxy: { t: 'US dollar index', s: 'daily · DXY', pts: () => fromRows('dxy'), f: (v) => fmtNum(v, 2), ft: (v) => fmtNum(v, 0) },
  us10y: { t: '10-year Treasury yield', s: 'daily · FRED', pts: () => fromRows('us10y'), f: (v) => fmtNum(v, 2) + '%', ft: (v) => fmtNum(v, 1) + '%' },
  vix: { t: 'VIX', s: 'daily · equity volatility', pts: () => fromRows('vix'), f: (v) => fmtNum(v, 1), ft: (v) => fmtNum(v, 0) },
  corr: { t: 'BTC–Nasdaq 30-day correlation', s: 'daily returns · derived', pts: () => fromRows('corrNdx30'), f: (v) => fmtNum(v, 2), ft: (v) => fmtNum(v, 1) },
  stables: { t: 'Stablecoin supply', s: 'daily · DefiLlama', pts: () => fromRows('stables'), f: (v) => fmtUsd(v, 1), ft: (v) => fmtUsd(v, 0) },
  mvrv: { t: 'MVRV (price ÷ on-chain cost basis)', s: 'daily · Coin Metrics', pts: () => fromRows('mvrv'), f: (v) => fmtNum(v, 2), ft: (v) => fmtNum(v, 1) },
};
function drawChart(el) {
  const key = el.dataset.chart || el.dataset.spark, spark = !!el.dataset.spark, c = CHARTS[key];
  if (!c) return;
  const pts = c.pts(), base = spark ? SPARK : BIG;
  // draw at the element's real pixel width so text and strokes are never scaled
  const px = Math.round(el.clientWidth - (spark ? 0 : 28));
  const o = { ...base, w: px > 100 ? px : base.w, h: spark ? base.h : (px && px < 500 ? 170 : base.h) };
  const tick = spark ? c.f : c.ft;
  const svg = c.kind === 'bars' ? barsSvg(pts, tick, o, c.empty, c.f) : lineSvg(pts, tick, o, c.empty, c.f);
  el.innerHTML = spark ? svg : `<div class="ct"><b>${esc(c.t)}</b><span>${esc(c.s)}</span></div>${c.legend ? '<p class="legend" style="margin:0 0 4px"><span><i style="background:var(--series-pos)"></i>Net inflow</span><span><i style="background:var(--series-neg)"></i>Net outflow</span></p>' : ''}${svg}`;
  wireChart(el);
}
function drawCharts(root = document) { root.querySelectorAll('[data-chart],[data-spark]').forEach(drawChart); }
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => drawCharts(document), 200); });
document.addEventListener('toggle', (e) => { if (e.target.matches?.('details.force') && e.target.open) drawCharts(e.target); }, true);
const chartEl = (key) => h`<div class="chart" data-chart="${key}"></div>`;
const sparkEl = (key) => h`<div class="chart spark" data-spark="${key}"></div>`;
const rangeBar = () => h`<div class="range" role="group" aria-label="Chart range">${[[30, '30D'], [90, '90D'], [180, '6M'], [365, '1Y']].map(([r, l]) => h`<button type="button" data-range="${r}" aria-pressed="${state.range === r}">${l}</button>`)}</div>`;

// ---------- sections ----------
function overview() {
  const a = state.a, m = a.metrics, P = m.price;
  const dep = m.depth, E = m.etf, D = m.derivs, O = m.options, M = m.macro, L = m.liq, C = m.corr;
  const tile = (label, ids, v, s, d, sk) => h`<div class="tile${isStale(ids) ? ' stale' : ''}"><div class="label">${label}${d ? raw(' ' + ser(dirChip(d))) : ''}</div><div class="v">${v}</div>${sk ? sparkEl(sk) : ''}<div class="s">${s}</div><div class="src">${srcLine(ids)}</div></div>`;
  const force = (id) => a.forces.find((f) => f.id === id);
  const sell100 = dep?.impact?.sell?.find((x) => x.sizeUsd === 100e6);
  return h`<section id="overview">
    <div class="hero">
      <div>
        <div class="label">BTC price ${isStale(['coingecko']) ? raw(ser(chip('stale', 'stale'))) : ''}</div>
        <div class="price">${fmtPrice(P.spot)}</div>
        <div class="changes">
          <span><span class="k">24H</span><span class="${cls(P.ch24h)}">${fmtPct(P.ch24h)}</span></span>
          <span><span class="k">7D</span><span class="${cls(P.ch7d)}">${fmtPct(P.ch7d)}</span></span>
          <span><span class="k">30D</span><span class="${cls(P.ch30d)}">${fmtPct(P.ch30d)}</span></span>
        </div>
        <div class="small muted" style="margin-top:10px">${P.drawdownPct !== null ? `${fmtPct(P.drawdownPct)} from ATH${P.ath ? ` (${fmtPrice(P.ath)}, ${P.athDate})` : ''}` : ''}${P.ma200 ? ` · 200-day avg ${fmtPrice(P.ma200)}` : ''}${P.rv30 !== null ? ` · 30d realised vol ${fmtNum(P.rv30, 0)}%` : ''}</div>
        <div class="xs dim" style="margin-top:6px">${srcLine(['coingecko'])}</div>
      </div>
      <div>
        <div class="label">Market regime</div>
        <div class="regime">${a.regime.primary}${a.regime.secondary ? raw(`<span class="muted" style="font-weight:400;font-size:15px"> · ${esc(a.regime.secondary)}</span>`) : ''}</div>
        <div class="regime-ex">${a.regime.explanation}</div>
        <div class="xs dim" style="margin-top:8px">${Object.entries(a.regime.reasons || {}).map(([k, r]) => `${k}: ${r.join(', ')}`).join(' · ')}</div>
      </div>
      <div class="attr">
        <div class="label">How price is moving — spot or derivatives?</div>
        ${[a.attribution.d1, a.attribution.d7].map((x) => h`<div class="row"><div class="h">${x.horizon === '1d' ? 'Last 24 hours' : 'Last 7 days'} · ${x.confidence}</div><b>${x.label}</b><div class="small muted">${x.explanation}</div></div>`)}
      </div>
    </div>
    <div class="pricechart">${rangeBar()}${chartEl('price')}</div>
    <div class="kpis">
      ${tile('Spot liquidity (±1% depth)', dep ? dep.venues.map((v) => 'book_' + v.venue.toLowerCase()) : ['book_binance'], dep ? fmtUsd(dep.d1) : 'n/a', dep ? h`${dep.ch7d !== null ? raw(`<span class="${cls(dep.ch7d)}">${esc(fmtPct(dep.ch7d))}</span> vs 7d · `) : 'no 7d history yet · '}top-2 venues ${Math.round(dep.top2Share * 100)}% · $100M sell ≈ ${sell100 ? (sell100.exhausted ? 'beyond captured depth' : fmtPct(-sell100.slippagePct, 2)) : 'n/a'}` : 'Order books unavailable', force('depth')?.direction, 'depth')}
      ${tile('ETF flow trend', ['farside'], E ? fmtUsdSigned(E.s5 * 1e6) + ' 5d' : 'n/a', E ? h`20d ${fmtUsdSigned(E.s20 * 1e6)} · last day (${E.lastDate}) ${fmtUsdSigned(E.last * 1e6)} · ${E.streak > 0 ? `${E.streak}-day inflow streak` : E.streak < 0 ? `${-E.streak}-day outflow streak` : 'no streak'} · ${E.accel > 0 ? 'accelerating' : 'decelerating'}` : 'ETF flow data unavailable', force('etf')?.direction, 'etf')}
      ${tile('Futures open interest', ['okx_deriv', 'deribit_fut', 'hyperliquid', 'bitmex', 'binance_deriv', 'bybit_deriv'].filter((id) => a.quality.some((q) => q.id === id && q.status !== 'error')), D ? fmtUsd(D.totalOi) : 'n/a', D ? h`${fmtNum(D.oiPctMcap)}% of mcap · 1d ${fmtPct(D.oiCh1d)} · 7d ${fmtPct(D.oiCh7d)} · 30d ${fmtPct(D.oiCh30d)} (${D.oiChBasis}) · venues: ${D.coverage.replace(/,/g, ', ')}${D.cot ? ` · CME ≈${fmtNum(D.cot.oiBtc / 1000, 0)}K BTC (CFTC ${D.cot.date})` : ''}` : 'unavailable', force('leverage')?.direction, 'oi')}
      ${tile('Funding & basis', ['okx_deriv', 'deribit_fut'], D?.fundingAnn !== null && D?.fundingAnn !== undefined ? fmtNum(D.fundingAnn, 1) + '% ann.' : 'n/a', D ? h`OI-weighted perps · dispersion ${fmtNum(D.fundingDispersionBps, 2)} bp/8h${D.basis ? ` · ${Math.round(D.basis.days)}d basis ${fmtNum(D.basis.annPct, 1)}%` : ''}${D.okxFunding7dAnn !== undefined ? ` · OKX 7d avg ${fmtNum(D.okxFunding7dAnn, 1)}%` : ''}` : 'unavailable', force('funding')?.direction, 'funding')}
      ${tile('Liquidations', ['okx_deriv'], L ? `${fmtUsd(L.longUsd)} L / ${fmtUsd(L.shortUsd)} S` : 'n/a', L ? h`OKX BTC-USDT perp, ${L.count} most recent forced orders (${fmtTime(L.from)} → ${fmtTime(L.to)}). Market-wide liquidation totals require CoinGlass/Kaiko (not available).` : 'Market-wide liquidation data is not available from free sources.', null)}
      ${tile('Options', ['deribit_opt', 'deribit_dvol'], O ? `IV ${fmtNum(O.atmIv30 ?? O.dvol, 1)}%` : 'n/a', O ? h`skew ${fmtNum(O.skew25, 1)} vp · P/C ${fmtNum(O.pcRatio)} · IV−RV ${fmtNum(O.ivRvSpread, 1)} · ${O.nextBigExpiry ? `${O.nextBigExpiry.expiry}: ${fmtUsd(O.nextBigExpiry.notionalUsd)} expiring, max pain ${fmtK(O.nextBigExpiry.maxPain)}` : ''}` : 'Deribit options unavailable', force('options')?.direction, 'dvol')}
      ${tile('Macro liquidity', ['fred', 'yahoo'], M?.netLiq ? fmtUsd(M.netLiq[1] * 1e9) : 'n/a', M ? h`net liquidity ${M.netLiq4w !== null ? fmtUsdSigned(M.netLiq4w * 1e9) : 'n/a'} 4w · real 10y ${M.real10y ? fmtNum(M.real10y[1], 2) + '%' : 'n/a'} · ${M.dollarLabel} ${fmtPct(M.dollar20d)} 4w · VIX ${M.vix ? fmtNum(M.vix[1], 1) : 'n/a'} · HY ${M.hy ? fmtNum(M.hy[1], 2) + '%' : 'n/a'}` : 'unavailable', force('macro')?.direction, 'netliq')}
      ${tile('BTC trading behaviour', ['yahoo', 'coingecko_hist'], C?.behaviour?.label ? C.behaviour.label : 'n/a', C ? h`30d corr: Nasdaq ${fmtNum(C.NDX?.c30)} · gold ${fmtNum(C.GOLD?.c30)} · dollar ${fmtNum(C.DXY?.c30)} · VIX ${fmtNum(C.VIX?.c30)} · dominance ${fmtNum(m.structure?.dominance, 1)}%` : 'unavailable', null, 'corr')}
    </div>
    <div class="twocol" style="margin-top:12px">
      <div class="panel"><h3>What changed since the previous observation${m.prevDates?.d1 ? ` (${m.prevDates.d1})` : ''}</h3>
        <ul class="clean">${a.changes.slice(0, 8).map((c) => h`<li>${c.z !== null && c.z !== undefined ? raw(`<span class="z">${esc(fmtNum(c.z, 1))}σ</span>`) : ''}${c.text.replace(/ \([^)]*σ[^)]*\)$/, '')}</li>`)}</ul>
        <p class="xs dim" style="margin-top:8px">σ = size of the change relative to the typical daily change in the stored history.</p>
      </div>
      <div class="panel"><h3>The three most important variables today</h3>
        <ol style="margin:0;padding-left:18px">${a.top.map((t) => h`<li style="margin-bottom:10px"><b>${t.name}</b> ${dirChip(t.direction)}<div class="small muted">${t.state}</div><div class="small"><span class="dim">Watch:</span> ${t.watch}</div></li>`)}</ol>
      </div>
    </div>
  </section>`;
}

const FORCE_CHARTS = { etf: ['etf'], depth: ['depth'], leverage: ['oi', 'oiAgg'], funding: ['funding'], spot: ['premium'], macro: ['netliq', 'real10y'], dollar: ['dxy', 'us10y'], options: ['dvol'], onchain: ['stables', 'mvrv'], riskappetite: ['corr', 'vix'] };
function forcesSection() {
  const a = state.a;
  const ev = (e) => h`<tr><td>${e.label}</td><td>${e.value}${e.source || e.derived ? raw(`<span class="srcl">${e.derived ? 'Derived by this system' : ''}${e.derived && e.source ? ' from ' : ''}${e.source ? esc(e.source) : ''}${e.asOf ? ' · ' + esc(fmtTime(e.asOf)) : ''}${e.frequency ? ' · ' + esc(e.frequency) : ''}${e.status && e.status !== 'ok' && e.status !== 'unavailable' ? ' · ' + esc(e.status.toUpperCase()) : ''}</span>`) : ''}</td></tr>`;
  return h`<section id="forces">
    <div class="sec-h"><h2><span class="n">01</span>What is moving BTC right now?</h2><div class="aside">Forces ranked by current importance (magnitude of change × structural relevance), not by direction. Expand a force for evidence, mechanism and what would invalidate the reading. This is not an investment signal.</div></div>
    ${a.forces.map((f, i) => h`<details class="force"${i === 0 ? raw(' open') : ''}>
      <summary>
        <span class="rank">${f.unavailable ? '–' : f.rank}</span>
        <span><span class="fname">${f.name}</span><div class="imp" title="importance ${f.importance}/100"><i style="width:${Math.max(2, f.importance)}%"></i></div></span>
        <span>${dirChip(f.direction)}</span>
        <span class="ev-col">${chip('evidence: ' + f.confidence, 'ev')}</span>
        <span class="fstate">${f.state}</span>
        <span class="caret">›</span>
      </summary>
      ${f.unavailable ? h`<div class="fbody"><p class="full">${f.state}</p></div>` : h`<div class="fbody">
        <div class="full"><h4>Current state <span class="tag">observed</span></h4><p>${f.state}</p></div>
        ${FORCE_CHARTS[f.id] ? h`<div class="full fcharts">${FORCE_CHARTS[f.id].map(chartEl)}</div>` : ''}
        <div class="full"><h4>Evidence</h4><div class="tbl-wrap"><table class="ev"><tbody>${f.evidence.map(ev)}</tbody></table></div></div>
        <div class="full"><h4>Transmission mechanism</h4><p class="mech">${f.mechanism}</p></div>
        <div><h4>Interpretation <span class="tag">analysis</span></h4><p>${f.interpretation}</p></div>
        <div><h4>Direction · evidence strength</h4><p>${dirChip(f.direction)} ${chip(f.confidence, 'ev')}</p></div>
        <div><h4>Change from yesterday</h4><p>${f.d1}</p></div>
        <div><h4>Change from 1 week ago</h4><p>${f.d7}</p></div>
        <div><h4>What would invalidate it</h4><p>${f.invalidation}</p></div>
        <div><h4>What to watch next</h4><p>${f.watch}</p></div>
      </div>`}
    </details>`)}
  </section>`;
}

function liquiditySection() {
  const a = state.a, map = a.map, dep = a.metrics.depth, O = a.metrics.options;
  if (!map) return h`<section id="liquidity"><div class="sec-h"><h2><span class="n">02</span>Liquidity map</h2></div><p class="muted">Price unavailable.</p></section>`;
  const mx = (k) => Math.max(1, ...map.levels.map((l) => l[k]));
  const mLL = mx('liqLong'), mLS = mx('liqShort'), mO = Math.max(1, ...map.levels.map((l) => l.callOi + l.putOi));
  const bar = (v, max, c, label) => h`<div class="mbar"><i class="${c}" style="width:${Math.round((v / max) * 70)}px"></i>${label}</div>`;
  const rows = map.levels.map((l) => {
    const acc = (t) => /squeeze|liquidation|vacuum|acceleration/.test(t) ? 'acc' : /congestion|support|pin|current/.test(t) ? 'dec' : '';
    return h`<tr class="${l.isSpot ? 'spot' : ''}">
      <td data-k="Level"><span class="lvl">${fmtK(l.level)}</span><div class="xs dim">${l.isSpot ? `spot ${fmtPrice(map.spot)}` : fmtPct(l.distPct, 1)}</div></td>
      <td data-k="What matters there"><div class="tags">${l.tags.map((t) => h`<span class="tagc ${acc(t)}">${t}</span>`)}</div><div class="small muted">${l.why.join('; ')}${l.markers.filter((x) => x !== 'SPOT').length ? raw(`<div class="xs" style="color:var(--orange-ink)">${esc(l.markers.filter((x) => x !== 'SPOT').join(' · '))}</div>`) : ''}</div></td>
      <td data-k="Visible liquidity" class="n">${l.bookCovered || l.isSpot ? fmtUsd(l.book) : raw('<span class="dim">beyond visible book</span>')}</td>
      <td data-k="Leverage (model)">${l.above || l.isSpot ? bar(l.liqShort, mLS, 's', 'S ' + fmtUsd(l.liqShort)) : ''}${!l.above || l.isSpot ? bar(l.liqLong, mLL, 'l', 'L ' + fmtUsd(l.liqLong)) : ''}</td>
      <td data-k="Options (Deribit)">${bar(l.callOi + l.putOi, mO, 'o', `${fmtNum(l.callOi, 0)}C / ${fmtNum(l.putOi, 0)}P BTC`)}<div class="xs dim">γ ${fmtUsd(l.gamma)}/1%</div></td>
      <td data-k="ETF context" class="small">${l.etfContext}</td>
      <td data-k="If crossed" class="small">${l.crossing}</td>
    </tr>`;
  });
  const imp = dep?.impact;
  return h`<section id="liquidity">
    <div class="sec-h"><h2><span class="n">02</span>Liquidity map</h2><div class="aside">Why could BTC accelerate if it crosses a level? $5K bands around spot. Not a prediction — a map of where forced or hedging flows could sit.</div></div>
    <p class="legend"><span><i style="background:var(--series-neg)"></i>Modelled long liquidations (below spot)</span><span><i style="background:var(--series-pos)"></i>Modelled short liquidations (above spot)</span><span><i style="background:var(--orange)"></i>Deribit option OI at strikes in band</span></p>
    <div class="tbl-wrap"><table class="lmap"><thead><tr><th>Level</th><th>What matters there</th><th class="n">Visible liquidity</th><th>Leverage (model)</th><th>Options</th><th>ETF context</th><th>If crossed</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="xs dim" style="margin-top:8px"><b>Liquidation figures are a model estimate, not observed data:</b> leverage added on days OKX open interest rose (scaled to aggregate OI) is placed at that day’s close, split long/short by OKX’s account ratio, across a 5×/10×/25×/50× leverage mix; positions whose liquidation price has already been crossed are removed. Visible liquidity = displayed order-book depth (only observable within ~±3% of spot). Option OI is Deribit only; gamma sign (dealer long/short) is not observable.</p>
    <div class="twocol" style="margin-top:16px">
      <div class="panel"><h3>Order-book depth by venue</h3>
        ${dep ? h`<div class="tbl-wrap" style="border:0"><table><thead><tr><th>Venue</th><th class="n">±0.5%</th><th class="n">±1%</th><th class="n">±2%</th><th class="n">Share ±1%</th><th class="n">Spread</th></tr></thead><tbody>
          ${dep.venues.map((v) => h`<tr><td>${v.venue} <span class="xs dim">${v.pair}</span></td><td class="n">${fmtUsd(v.d05)}</td><td class="n">${fmtUsd(v.d1)}${v.truncated1 ? '*' : ''}</td><td class="n">${fmtUsd(v.d2)}${v.truncated2 ? '*' : ''}</td><td class="n">${Math.round((v.d1 / dep.d1) * 100)}%</td><td class="n">${fmtNum(v.spreadBps, 2)}bp</td></tr>`)}
          <tr><td><b>Aggregate</b></td><td class="n">${fmtUsd(dep.d05)}</td><td class="n"><b>${fmtUsd(dep.d1)}</b></td><td class="n">${fmtUsd(dep.d2)}</td><td class="n">HHI ${Math.round(dep.hhi)}</td><td></td></tr>
        </tbody></table></div>
        <p class="xs dim">Bid/ask imbalance at ±1%: ${fmtPct(dep.imbalance1 * 100, 1)} (positive = more bids). Change vs 1d / 7d / 30d: ${fmtPct(dep.ch1d)} / ${fmtPct(dep.ch7d)} / ${fmtPct(dep.ch30d)} (like-for-like venue set only). * venue book did not extend to the full band. USDT books treated at $1.</p>` : h`<p class="muted">Unavailable.</p>`}
      </div>
      <div class="panel"><h3>Can the market absorb aggressive flow?</h3>
        ${imp ? h`<div class="tbl-wrap" style="border:0"><table><thead><tr><th>Order</th><th class="n">Sell impact</th><th class="n">Worst fill</th><th class="n">Buy impact</th></tr></thead><tbody>
          ${imp.sell.map((s, i) => { const b = imp.buy[i]; return h`<tr><td class="num">${fmtUsd(s.sizeUsd)}</td><td class="n">${s.exhausted ? raw('<span class="down">beyond captured depth</span>') : fmtPct(-s.slippagePct, 2)}</td><td class="n">${s.exhausted ? `filled ${fmtUsd(s.filledUsd)}` : fmtPrice(s.worstPrice)}</td><td class="n">${b.exhausted ? raw('<span class="up">beyond captured depth</span>') : fmtPct(b.slippagePct, 2)}</td></tr>`; })}
        </tbody></table></div>
        <p class="xs dim">Idealised: walks the combined displayed books of ${imp.venues.join(', ')} with perfect routing. <b>Displayed ≠ executed liquidity</b> — during stress makers cancel quotes, so real impact is typically larger. “Beyond captured depth” means the order is larger than all the liquidity this snapshot captured — not that the market cannot absorb it.${dep.venues.some((v) => v.truncated2) ? ` Several venue APIs return a limited number of price levels, so their books are captured only partway: ${dep.venues.filter((v) => v.truncated2).map((v) => v.venue).join(', ')} (marked * in the depth table). Large-order impact is therefore a lower bound on available liquidity.` : ''}</p>` : h`<p class="muted">Unavailable.</p>`}
      </div>
    </div>
    ${O ? h`<div class="panel" style="margin-top:12px"><h3>Options expiries (Deribit)</h3><div class="tbl-wrap" style="border:0"><table><thead><tr><th>Expiry</th><th class="n">Days</th><th class="n">Notional</th><th class="n">P/C OI</th><th class="n">Max pain</th><th class="n">ATM IV</th><th class="n">25Δ skew</th><th>Largest strikes</th></tr></thead><tbody>
      ${O.expiries.slice(0, 8).map((e) => h`<tr><td class="num">${e.expiry}</td><td class="n">${fmtNum(e.days, 1)}</td><td class="n">${fmtUsd(e.notionalUsd)}</td><td class="n">${fmtNum(e.callOi ? e.putOi / e.callOi : null)}</td><td class="n">${fmtK(e.maxPain)}</td><td class="n">${fmtNum(e.atmIv, 1)}%</td><td class="n">${fmtNum(e.skew25, 1)}</td><td class="small">${e.topStrikes.map((s) => fmtK(s.strike)).join(', ')}</td></tr>`)}
    </tbody></table></div><p class="xs dim">Max pain = strike minimising option holders’ intrinsic value at expiry — a pinning reference only for large near-dated expiries. Skew = 25Δ call IV − 25Δ put IV (negative = puts richer).</p></div>` : ''}
  </section>`;
}

function scenariosSection() {
  const a = state.a;
  const stc = (s) => (s === 'met' ? 'met' : s === 'not met' ? 'notmet' : 'unknown');
  return h`<section id="scenarios">
    <div class="sec-h"><h2><span class="n">03</span>Upside / downside acceleration</h2><div class="aside">Conditional scenarios, not forecasts. Each lists what must happen first (with today’s status), what would confirm or contradict it, and the liquidity mechanism. No probabilities are assigned — there is no statistically defensible basis for them.</div></div>
    <div class="scen">${a.scenarios.map((s) => h`<div class="panel">
      <h3>${s.name} <span class="xs dim">${s.first.filter((c) => c.status === 'met').length}/${s.first.length} preconditions met</span></h3>
      <div class="xs dim" style="margin-bottom:4px">WHAT HAS TO HAPPEN FIRST</div>
      ${s.first.map((c) => h`<div class="cond"><span class="st ${stc(c.status)}">${c.status}</span><span>${c.text}<span class="val">now: ${c.value}</span></span></div>`)}
      <dl>
        <dt>Confirming indicators</dt><dd>${s.confirm.join('; ')}</dd>
        <dt>Contradicting indicators</dt><dd>${s.contradict.join('; ')}</dd>
        <dt>Potential acceleration points</dt><dd>${s.levels.length ? s.levels.map((l) => `${fmtK(l.level)} (${l.tags.join(', ')})`).join('; ') : 'None identified on current data'}</dd>
        <dt>Liquidity mechanism</dt><dd>${s.mechanism}</dd>
        <dt>What would cause it to fail</dt><dd>${s.failure}</dd>
      </dl></div>`)}</div>
  </section>`;
}

function reportSection() {
  const a = state.a;
  const opts = (state.index?.reports || []).slice(0, 120);
  return h`<section id="report">
    <div class="sec-h"><h2><span class="n">04</span>Morning report</h2><div class="aside">Generated daily at 07:00 ${state.index?.timezone || ''} by the agent; archived permanently. Manual refreshes are archived with a time suffix.</div></div>
    <div class="report-bar">
      <label class="small muted" for="rep-sel">Report</label>
      <select id="rep-sel"><option value="">Current (${a.kind === 'browser' ? 'browser refresh' : a.kind || 'latest'} · ${fmtTime(a.generatedAt)})</option>${opts.map((r) => h`<option value="${r.id}">${r.id}${r.kind === 'morning' ? ' · 07:00 report' : ' · refresh'}${r.price ? ' · ' + fmtPrice(r.price) : ''}</option>`)}</select>
      <a class="btn ghost" id="rep-dl" href="#" download="btc-market-intelligence.md">Download .md</a>
    </div>
    <div class="report" id="rep-body">${md(a.reportMd)}${a.narrative?.text ? h`<hr><h1>Analyst narrative</h1><div class="narr">${md(a.narrative.text)}</div><p class="xs dim">Written by ${a.narrative.model || 'Claude'} from the computed data above; it may not introduce data that is not shown.</p>` : ''}</div>
  </section>`;
}

function coverageSection() {
  const a = state.a;
  const st = (q) => chip(q.status === 'server-only' ? 'server value' : q.status, q.status === 'ok' ? 'ok' : q.status === 'error' ? 'err' : 'stale');
  return h`<section id="coverage">
    <div class="sec-h"><h2><span class="n">05</span>Data coverage &amp; methodology</h2><div class="aside">Every number on this page traces to one of these sources. Failed sources keep their last value, marked stale with its original timestamp.</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>As of</th><th>Frequency</th><th>Method / notes</th></tr></thead><tbody>
      ${a.quality.slice().sort((x, y) => (x.status === y.status ? 0 : x.status === 'ok' ? 1 : -1)).map((q) => h`<tr><td>${safeUrl(q.url) ? h`<a href="${safeUrl(q.url)}" target="_blank" rel="noopener">${q.name}</a>` : q.name}</td><td>${st(q)}</td><td class="small num">${fmtTime(q.asOf || q.fetchedAt)}</td><td class="small">${q.frequency || ''}</td><td class="small">${q.method || ''}${q.note ? raw(`<div class="xs" style="color:var(--warn)">${esc(q.note)}</div>`) : ''}${q.error ? raw(`<div class="xs" style="color:var(--down)">${esc(q.error)}</div>`) : ''}</td></tr>`)}
    </tbody></table></div>
    <div class="twocol" style="margin-top:12px">
      <div class="panel"><h3>Not available (and why)</h3><ul class="clean">${a.unavailable.map((u) => h`<li><b>${u.metric}.</b> <span class="muted">${u.why}</span></li>`)}</ul></div>
      <div class="panel"><h3>Methodology notes</h3><ul class="clean small">
        <li><b>Open interest</b> is summed across reachable venues at each venue’s own mark (OKX swaps+futures, Binance, Bybit, Deribit, BitMEX, Hyperliquid). Venues differ in contract design (linear USDT vs inverse USD); figures are USD notional. CME is shown separately from weekly CFTC data. Changes are only computed against history with the same venue set; otherwise the consistent OKX daily series is used and labelled.</li>
        <li><b>Funding</b> is normalised to an 8-hour rate (Hyperliquid pays hourly) and OI-weighted; annualised = 8h × 3 × 365.</li>
        <li><b>Depth</b> = displayed USD liquidity within ±0.5/1/2% of each venue’s mid from a single snapshot. This differs from Kaiko’s methodology (time-averaged, different venue set); comparisons with published figures are approximate.</li>
        <li><b>Correlations</b> use daily log returns on common trading days (yields and VIX in level changes). Correlation describes co-movement, not causation.</li>
        <li><b>Gamma</b> uses Black-Scholes with Deribit mark IV; reported as $ hedge change per 1% move. Dealer sign is not observable.</li>
        <li><b>ETF flow-weighted basis</b> = cumulative net USD flows ÷ cumulative BTC implied at each day’s close — an approximation of average entry price, not issuer cost basis.</li>
        <li><b>Regime and move classification</b> use explicit thresholds listed in <a href="https://github.com/bitcoincustodystandard/bitcoincustodystandard.github.io/blob/main/intelligence/README.md" target="_blank" rel="noopener">the methodology</a>; evidence strength falls when inputs are missing.</li>
      </ul></div>
    </div>
  </section>`;
}

// ---------- render ----------
function render() {
  const a = state.a;
  $('#st-updated').textContent = fmtTime(a.generatedAt);
  $('#st-through').textContent = fmtTime(a.dataThrough);
  $('#st-mode').textContent = a.kind === 'browser' ? 'Browser refresh' : a.kind === 'morning' ? '07:00 report' : 'Server refresh';
  const staleN = a.quality.filter((q) => q.status === 'stale').length;
  const errN = a.quality.filter((q) => q.status === 'error').length;
  const old = ageH(a.dataThrough);
  const banners = [];
  if (old !== null && old > 30) banners.push(h`<div class="banner warn">The latest analysis is ${Math.round(old)} hours old. Press <b>Refresh market</b> to update crypto market data in your browser, or start a server run.</div>`);
  const liveN = a.quality.filter((q) => q.status === 'ok').length;
  if (a.kind === 'browser' && liveN < 5) banners.push(h`<div class="banner warn">Browser refresh could reach only ${liveN} of ${a.quality.length} sources from this network (blocked, rate-limited or no cross-origin access). All other values are the last server values, marked stale with their original timestamps. Try again later or start a <b>Server run</b>.</div>`);
  else if (a.kind === 'browser') banners.push(h`<div class="banner">Browser refresh: ${liveN} sources were retrieved live (exchange, derivatives, options and on-chain data where reachable). ETF flows, FRED macro, Yahoo markets and CFTC data cannot be fetched from a browser and show their last server values (marked “server value”). This refresh is not saved to the archive — use <b>Server run</b> for that.</div>`);
  else if (staleN || errN) banners.push(h`<div class="banner warn">${staleN ? `${staleN} source(s) could not be refreshed and show their last known values, marked stale. ` : ''}${errN ? `${errN} source(s) were unavailable in the last run (e.g. venues that block US servers); where an alternative exists it is used and labelled. ` : ''}See <a href="#coverage">Data &amp; method</a>.</div>`);
  $('#app').innerHTML = [h`${banners}`, overview(), forcesSection(), liquiditySection(), scenariosSection(), reportSection(), coverageSection()].map((x) => x.s).join('');
  drawCharts($('#app'));
  wireSections();
  const np = $('#nav-price');
  if (np) np.innerHTML = h`${fmtPrice(a.metrics.price.spot)} <span class="${cls(a.metrics.price.ch24h)}">${fmtPct(a.metrics.price.ch24h)}</span>`.s;
}

function wireSections() {
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    state.range = +b.dataset.range;
    document.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.range === state.range)));
    drawCharts($('#app'));
  }));
  const sel = $('#rep-sel'), dl = $('#rep-dl');
  const setDl = (text) => { dl.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); };
  setDl(state.a.reportMd + (state.a.narrative?.text ? '\n\n# Analyst narrative\n\n' + state.a.narrative.text : ''));
  sel.addEventListener('change', async () => {
    const id = sel.value;
    if (!id) { $('#rep-body').innerHTML = md(state.a.reportMd).s; setDl(state.a.reportMd); return; }
    try {
      const j = await getJSON(`data/history/${encodeURIComponent(id)}.json`);
      const t = j.reportMd + (j.narrative?.text ? '\n\n---\n\n# Analyst narrative\n\n' + j.narrative.text : '');
      $('#rep-body').innerHTML = md(t).s; dl.download = `btc-market-intelligence-${id}.md`; setDl(t);
    } catch { $('#rep-body').textContent = 'Could not load that report.'; }
  });
}

// ---------- data ----------
const runPoint = (r) => ({ price: r.price, depth1: r.depth1, depthVenues: r.depthVenues, depthBid1: r.depthBid1, depthAsk1: r.depthAsk1, oiTotal: r.oiTotal, oiCoverage: r.oiCoverage, fundingAnn: r.fundingAnn, iv30: r.iv30, cbPremium: r.cbPremium });
async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); }

async function load() {
  const [latest, ts, idx, runs] = await Promise.allSettled([getJSON('data/latest.json'), getJSON('data/timeseries.json'), getJSON('data/index.json'), getJSON('data/runs.json')]);
  state.runs = runs.status === 'fulfilled' ? runs.value.runs || [] : [];
  state.rows = ts.status === 'fulfilled' ? ts.value.rows || [] : [];
  state.index = idx.status === 'fulfilled' ? idx.value : null;
  if (latest.status === 'fulfilled' && latest.value?.metrics) { state.a = latest.value; render(); return; }
  $('#app').innerHTML = h`<div class="empty-state"><p><b>No stored analysis yet.</b></p><p>The agent has not completed its first server run. Press <b>Refresh market</b> to build the analysis now from live exchange data in your browser.</p></div>`.s;
  $('#st-mode').textContent = 'no data';
}

const progress = (t) => { $('#progress').textContent = t || ''; };

async function liveRefresh() {
  const btn = $('#btn-refresh');
  btn.disabled = true;
  const t0 = Date.now();
  try {
    progress('Retrieving order books, derivatives, options and on-chain data from source APIs…');
    if (!state.snapshot) state.snapshot = await getJSON('data/snapshot.json').catch(() => null);
    let snap = await collectAll({ scope: 'browser', log: progress });
    snap = mergeWithPrevious(snap, state.snapshot);
    for (const id of SERVER_ONLY) {
      const p = state.snapshot?.sources?.[id];
      if (p) snap.sources[id] = { ...p, status: p.status === 'ok' ? 'server-only' : p.status, lastError: 'not retrievable from a browser (no CORS); last server value shown' };
    }
    progress('Analysing…');
    if (!state.rows.length) state.rows = (await getJSON('data/timeseries.json').catch(() => ({ rows: [] }))).rows;
    const a = analyze(snap, state.rows);
    a.kind = 'browser';
    a.reportMd = morningReport(a);
    a.narrative = null;
    state.a = a;
    state.runs = (state.runs || []).concat([{ t: a.dataThrough, live: true, ...runPoint(a.row) }]);
    render();
    const ok = a.quality.filter((q) => q.status === 'ok').length;
    progress(`Refreshed in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${ok} of ${a.quality.length} sources live.`);
    setTimeout(() => progress(''), 12000);
  } catch (e) {
    progress('Refresh failed: ' + e.message);
  } finally { btn.disabled = false; }
}

// ---------- server run (GitHub Actions workflow_dispatch) ----------
function serverDialog() {
  const dlg = $('#dlg-server');
  try { $('#gh-token').value = localStorage.getItem('bmi-gh-token') || ''; } catch {}
  $('#dispatch-msg').textContent = '';
  dlg.showModal();
}
async function dispatch() {
  const tok = $('#gh-token').value.trim();
  const msg = $('#dispatch-msg');
  if (!tok) { msg.textContent = 'A token is required (or use “Open in GitHub” → Run workflow).'; return; }
  try { localStorage.setItem('bmi-gh-token', tok); } catch {}
  msg.textContent = 'Starting…';
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body: JSON.stringify({ ref: 'main' }) });
    if (r.status !== 204) throw new Error(`GitHub responded ${r.status}: ${(await r.text()).slice(0, 160)}`);
    msg.textContent = 'Server run started. This page will reload automatically when the new analysis is published (usually 3–6 minutes).';
    const before = state.a?.generatedAt;
    let n = 0;
    const iv = setInterval(async () => {
      n++;
      const l = await getJSON('data/latest.json').catch(() => null);
      if (l && l.generatedAt !== before && l.kind !== 'browser') { clearInterval(iv); state.a = l; state.rows = (await getJSON('data/timeseries.json').catch(() => ({ rows: state.rows }))).rows; state.index = await getJSON('data/index.json').catch(() => state.index); render(); progress('Server analysis published.'); }
      if (n > 15) { clearInterval(iv); progress('Server run still in progress — reload the page in a few minutes.'); }
    }, 60000);
  } catch (e) { msg.textContent = 'Could not start: ' + e.message; }
}

$('#btn-refresh').addEventListener('click', liveRefresh);
$('#btn-refresh2')?.addEventListener('click', liveRefresh);
$('#btn-server').addEventListener('click', serverDialog);
$('#btn-dispatch').addEventListener('click', dispatch);
$('#btn-close').addEventListener('click', () => $('#dlg-server').close());
$('#btn-forget').addEventListener('click', () => { try { localStorage.removeItem('bmi-gh-token'); } catch {} $('#gh-token').value = ''; $('#dispatch-msg').textContent = 'Token removed from this browser.'; });
$('#btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur;
  try { localStorage.setItem('bmi-theme', cur); } catch {}
});
load();
