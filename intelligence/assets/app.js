// Bitcoin Market Intelligence — page controller.
// Renders the agent's latest analysis and can regenerate it in the browser
// using the same engine the scheduled agent runs.

import { analyze } from '../engine/analyze.js';
import { collectAll, mergeWithPrevious } from '../engine/collect.js';
import { morningReport } from '../engine/report.js';
import { QUERIES } from '../engine/history.js';
import { ANALOGUES, FEB2026 } from '../engine/reference.js';
import { fmtUsd, fmtUsdSigned, fmtPrice, fmtPct, fmtNum, fmtK, ordinal } from '../engine/util.js';

const REPO = 'bitcoincustodystandard/bitcoincustodystandard.github.io';
const WORKFLOW = 'market-intel.yml';
const SERVER_ONLY = ['farside', 'fred', 'yahoo', 'cftc_cot'];
const state = { a: null, rows: [], index: null, snapshot: null, range: 90, query: 'between' };
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
const W = 600, H = 190, PAD = { l: 52, r: 12, t: 10, b: 24 };
function niceTicks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
  return t;
}
function chartShell(title, sub, svg, legend = '') {
  return h`<div class="chart"><div class="ct"><b>${title}</b><span>${sub}</span></div>${legend ? raw(legend) : ''}${raw(svg)}</div>`;
}
function lineSvg(pts, fmt) {
  if (!pts || pts.length < 2) return `<svg viewBox="0 0 ${W} ${H}" role="img"><text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">Not enough stored history yet</text></svg>`;
  const xs = pts.map((p) => new Date(p[0]).getTime()), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks.at(-1);
  const X = (x) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const Y = (y) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const grid = ticks.map((t) => `<line class="gridl" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${PAD.l - 6}" y="${Y(t) + 3}" text-anchor="end">${esc(fmt(t))}</text>`).join('');
  const xl = [0, Math.floor(pts.length / 2), pts.length - 1].map((i) => `<text class="axis" x="${X(xs[i])}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${esc(pts[i][0].slice(2))}</text>`).join('');
  const data = esc(JSON.stringify(pts.map((p, i) => [X(xs[i]), Y(p[1]), p[0], fmt(p[1])])));
  return `<svg viewBox="0 0 ${W} ${H}" data-line="${data}" role="img" aria-label="line chart">${grid}${xl}<path class="ln" d="${path}"/><line class="xh" y1="${PAD.t}" y2="${H - PAD.b}" style="display:none"/><circle class="dot" r="4" style="display:none"/></svg>`;
}
function barsSvg(pts, fmt) {
  if (!pts || pts.length < 2) return `<svg viewBox="0 0 ${W} ${H}"><text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">No flow history</text></svg>`;
  const ys = pts.map((p) => p[1]);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
  const y0 = ticks[0], y1 = ticks.at(-1);
  const Y = (y) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const bw = (W - PAD.l - PAD.r) / pts.length;
  const grid = ticks.map((t) => `<line class="${t === 0 ? 'zero' : 'gridl'}" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${PAD.l - 6}" y="${Y(t) + 3}" text-anchor="end">${esc(fmt(t))}</text>`).join('');
  const bars = pts.map(([d, v], i) => {
    const x = PAD.l + i * bw + Math.min(1, bw * 0.15), w = Math.max(1, bw - Math.min(2, bw * 0.3));
    const y = v >= 0 ? Y(v) : Y(0), hh = Math.max(1, Math.abs(Y(v) - Y(0)));
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="${Math.min(2, w / 2)}" fill="var(${v >= 0 ? '--series-pos' : '--series-neg'})" data-tip="${esc(d + '|' + fmt(v))}" tabindex="-1"/>`;
  }).join('');
  const xl = [0, pts.length - 1].map((i) => `<text class="axis" x="${PAD.l + i * bw + (i ? bw : 0)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${esc(pts[i][0].slice(2))}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="bar chart">${grid}${bars}${xl}</svg>`;
}
function wireCharts(root) {
  root.querySelectorAll('.chart').forEach((c) => {
    const svg = c.querySelector('svg');
    let tip = c.querySelector('.tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.style.display = 'none'; c.appendChild(tip); }
    const show = (x, y, d, v) => {
      tip.replaceChildren();
      const b = document.createElement('b'); b.textContent = v; const s = document.createElement('span'); s.textContent = d;
      tip.append(b, s); tip.style.display = 'block';
      const r = svg.getBoundingClientRect(), cr = c.getBoundingClientRect();
      const px = (x / W) * r.width + (r.left - cr.left), py = (y / H) * r.height + (r.top - cr.top);
      tip.style.left = Math.min(px + 10, cr.width - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.max(py - 40, 4) + 'px';
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
        rc.addEventListener('pointerenter', () => { const [d, v] = rc.dataset.tip.split('|'); rc.style.opacity = 0.75; show(+rc.getAttribute('x'), +rc.getAttribute('y'), d, v); });
        rc.addEventListener('pointerleave', () => { rc.style.opacity = ''; tip.style.display = 'none'; });
      });
    }
  });
}

// ---------- sections ----------
function overview() {
  const a = state.a, m = a.metrics, P = m.price;
  const dep = m.depth, E = m.etf, D = m.derivs, O = m.options, M = m.macro, L = m.liq, C = m.corr;
  const tile = (label, ids, v, s, d) => h`<div class="tile${isStale(ids) ? ' stale' : ''}"><div class="label">${label}${d ? raw(' ' + ser(dirChip(d))) : ''}</div><div class="v">${v}</div><div class="s">${s}</div><div class="src">${srcLine(ids)}</div></div>`;
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
    <div class="kpis">
      ${tile('Spot liquidity (±1% depth)', dep ? dep.venues.map((v) => 'book_' + v.venue.toLowerCase()) : ['book_binance'], dep ? fmtUsd(dep.d1) : 'n/a', dep ? h`${dep.ch7d !== null ? raw(`<span class="${cls(dep.ch7d)}">${esc(fmtPct(dep.ch7d))}</span> vs 7d · `) : 'no 7d history yet · '}top-2 venues ${Math.round(dep.top2Share * 100)}% · $100M sell ≈ ${sell100 ? (sell100.exhausted ? 'beyond ±3% book' : fmtPct(-sell100.slippagePct, 2)) : 'n/a'}` : 'Order books unavailable', force('depth')?.direction)}
      ${tile('ETF flow trend', ['farside'], E ? fmtUsdSigned(E.s5 * 1e6) + ' 5d' : 'n/a', E ? h`20d ${fmtUsdSigned(E.s20 * 1e6)} · last day (${E.lastDate}) ${fmtUsdSigned(E.last * 1e6)} · ${E.streak > 0 ? `${E.streak}-day inflow streak` : E.streak < 0 ? `${-E.streak}-day outflow streak` : 'no streak'} · ${E.accel > 0 ? 'accelerating' : 'decelerating'}` : 'ETF flow data unavailable', force('etf')?.direction)}
      ${tile('Futures open interest', ['okx_deriv', 'deribit_fut', 'hyperliquid', 'bitmex', 'binance_deriv', 'bybit_deriv'].filter((id) => a.quality.some((q) => q.id === id && q.status !== 'error')), D ? fmtUsd(D.totalOi) : 'n/a', D ? h`${fmtNum(D.oiPctMcap)}% of mcap · 1d ${fmtPct(D.oiCh1d)} · 7d ${fmtPct(D.oiCh7d)} · 30d ${fmtPct(D.oiCh30d)} (${D.oiChBasis}) · venues: ${D.coverage.replace(/,/g, ', ')}${D.cot ? ` · CME ≈${fmtNum(D.cot.oiBtc / 1000, 0)}K BTC (CFTC ${D.cot.date})` : ''}` : 'unavailable', force('leverage')?.direction)}
      ${tile('Funding & basis', ['okx_deriv', 'deribit_fut'], D?.fundingAnn !== null && D?.fundingAnn !== undefined ? fmtNum(D.fundingAnn, 1) + '% ann.' : 'n/a', D ? h`OI-weighted perps · dispersion ${fmtNum(D.fundingDispersionBps, 2)} bp/8h${D.basis ? ` · ${Math.round(D.basis.days)}d basis ${fmtNum(D.basis.annPct, 1)}%` : ''}${D.okxFunding7dAnn !== undefined ? ` · OKX 7d avg ${fmtNum(D.okxFunding7dAnn, 1)}%` : ''}` : 'unavailable', force('funding')?.direction)}
      ${tile('Liquidations', ['okx_deriv'], L ? `${fmtUsd(L.longUsd)} L / ${fmtUsd(L.shortUsd)} S` : 'n/a', L ? h`OKX BTC-USDT perp, ${L.count} most recent forced orders (${fmtTime(L.from)} → ${fmtTime(L.to)}). Market-wide liquidation totals require CoinGlass/Kaiko (not available).` : 'Market-wide liquidation data is not available from free sources.', null)}
      ${tile('Options', ['deribit_opt', 'deribit_dvol'], O ? `IV ${fmtNum(O.atmIv30 ?? O.dvol, 1)}%` : 'n/a', O ? h`skew ${fmtNum(O.skew25, 1)} vp · P/C ${fmtNum(O.pcRatio)} · IV−RV ${fmtNum(O.ivRvSpread, 1)} · ${O.nextBigExpiry ? `${O.nextBigExpiry.expiry}: ${fmtUsd(O.nextBigExpiry.notionalUsd)} expiring, max pain ${fmtK(O.nextBigExpiry.maxPain)}` : ''}` : 'Deribit options unavailable', force('options')?.direction)}
      ${tile('Macro liquidity', ['fred', 'yahoo'], M?.netLiq ? fmtUsd(M.netLiq[1] * 1e9) : 'n/a', M ? h`net liquidity ${M.netLiq4w !== null ? fmtUsdSigned(M.netLiq4w * 1e9) : 'n/a'} 4w · real 10y ${M.real10y ? fmtNum(M.real10y[1], 2) + '%' : 'n/a'} · ${M.dollarLabel} ${fmtPct(M.dollar20d)} 4w · VIX ${M.vix ? fmtNum(M.vix[1], 1) : 'n/a'} · HY ${M.hy ? fmtNum(M.hy[1], 2) + '%' : 'n/a'}` : 'unavailable', force('macro')?.direction)}
      ${tile('BTC trading behaviour', ['yahoo', 'coingecko_hist'], C?.behaviour?.label ? C.behaviour.label : 'n/a', C ? h`30d corr: Nasdaq ${fmtNum(C.NDX?.c30)} · gold ${fmtNum(C.GOLD?.c30)} · dollar ${fmtNum(C.DXY?.c30)} · VIX ${fmtNum(C.VIX?.c30)} · dominance ${fmtNum(m.structure?.dominance, 1)}%` : 'unavailable', null)}
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
          ${imp.sell.map((s, i) => { const b = imp.buy[i]; return h`<tr><td class="num">${fmtUsd(s.sizeUsd)}</td><td class="n">${s.exhausted ? raw('<span class="down">book exhausted</span>') : fmtPct(-s.slippagePct, 2)}</td><td class="n">${s.exhausted ? `filled ${fmtUsd(s.filledUsd)}` : fmtPrice(s.worstPrice)}</td><td class="n">${b.exhausted ? raw('<span class="up">book exhausted</span>') : fmtPct(b.slippagePct, 2)}</td></tr>`; })}
        </tbody></table></div>
        <p class="xs dim">Idealised: walks the combined displayed books of ${imp.venues.join(', ')} with perfect routing. <b>Displayed ≠ executed liquidity</b> — during stress makers cancel quotes, so real impact is typically larger. “Book exhausted” means the order would clear all displayed liquidity within ±3% captured here.</p>` : h`<p class="muted">Unavailable.</p>`}
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

function febSection() {
  const a = state.a, F = a.feb;
  const vcls = (v) => (v === 'similar' ? 'similar' : v === 'partly similar' ? 'partly' : v === 'different' ? 'different' : 'unknown');
  return h`<section id="feb2026">
    <div class="sec-h"><h2><span class="n">04</span>February 2026 comparison</h2><div class="aside">How similar is today’s market structure to the January–February 2026 setup (≈$90K → ≈$60–63K)? Assessed dimension by dimension.</div></div>
    <div class="verdict">${F.verdict}</div>
    <div class="tbl-wrap"><table><thead><tr><th>Dimension</th><th>January–February 2026</th><th>Today</th><th>Assessment</th></tr></thead><tbody>
      ${F.dims.map((d) => h`<tr><td><b>${d.label}</b></td><td class="small">${d.feb}</td><td class="small">${d.today}${d.note ? raw(`<div class="xs dim" style="margin-top:4px">${esc(d.note)}</div>`) : ''}</td><td><span class="vd ${vcls(d.verdict)}">${d.verdict}</span></td></tr>`)}
    </tbody></table></div>
    <div class="twocol" style="margin-top:12px">
      <div class="panel"><h3>Current risk amplifiers</h3><ul class="clean">${F.amplifiers.length ? F.amplifiers.map((x) => h`<li>${x}</li>`) : h`<li class="muted">None flagged on current data.</li>`}</ul></div>
      <div class="panel"><h3>Current risk dampeners</h3><ul class="clean">${F.dampeners.length ? F.dampeners.map((x) => h`<li>${x}</li>`) : h`<li class="muted">None flagged on current data.</li>`}</ul></div>
    </div>
    <p class="xs dim" style="margin-top:8px">${F.note}</p>
    <div class="panel flat" style="margin-top:14px;padding-left:0;padding-right:0">
      <h3>Reference case: the February 2026 mechanism chain</h3>
      <p class="lead">${FEB2026.summary}</p>
      <div class="chain">${FEB2026.chain.map((s) => h`<div class="step"><div><b>${s.step}</b><p>${s.text}</p>${s.evidence.map((e) => h`<p class="evi">${e.text} — ${safeUrl(e.url) ? h`<a href="${safeUrl(e.url)}" target="_blank" rel="noopener">${e.source}</a>` : e.source}</p>`)}</div></div>`)}</div>
    </div>
  </section>`;
}

function reportSection() {
  const a = state.a;
  const opts = (state.index?.reports || []).slice(0, 120);
  return h`<section id="report">
    <div class="sec-h"><h2><span class="n">05</span>Morning report</h2><div class="aside">Generated daily at 07:00 ${state.index?.timezone || ''} by the agent; archived permanently. Manual refreshes are archived with a time suffix.</div></div>
    <div class="report-bar">
      <label class="small muted" for="rep-sel">Report</label>
      <select id="rep-sel"><option value="">Current (${a.kind === 'browser' ? 'browser refresh' : a.kind || 'latest'} · ${fmtTime(a.generatedAt)})</option>${opts.map((r) => h`<option value="${r.id}">${r.id}${r.kind === 'morning' ? ' · 07:00 report' : ' · refresh'}${r.price ? ' · ' + fmtPrice(r.price) : ''}</option>`)}</select>
      <a class="btn ghost" id="rep-dl" href="#" download="btc-market-intelligence.md">Download .md</a>
    </div>
    <div class="report" id="rep-body">${md(a.reportMd)}${a.narrative?.text ? h`<hr><h1>Analyst narrative</h1><div class="narr">${md(a.narrative.text)}</div><p class="xs dim">Written by ${a.narrative.model || 'Claude'} from the computed data above; it may not introduce data that is not shown.</p>` : ''}</div>
  </section>`;
}

function historySection() {
  return h`<section id="history">
    <div class="sec-h"><h2><span class="n">06</span>Historical context</h2><div class="aside">Analogues are documented episodes, not templates — each lists similarities and the mechanism, so differences from today are explicit.</div></div>
    <div class="analogues">${ANALOGUES.map((x) => h`<div class="panel analogue"><div class="type">${x.type}</div><h3>${x.label}</h3><p><span class="k">Trigger</span><br>${x.trigger}</p><p><span class="k">Mechanism</span><br>${x.mechanism}</p><p><span class="k">Data</span><br>${x.data}</p><p><span class="k">Lesson</span><br>${x.lesson}</p><p class="xs dim">${x.sources.map((s) => (safeUrl(s.url) ? h`<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${s.name}</a>` : s.name)).reduce((acc, v, i) => (i ? h`${acc} · ${v}` : h`${v}`), '')}</p></div>`)}</div>
    <div class="sec-h" style="margin-top:28px"><h2 style="font-size:12px">Stored observations</h2><div class="range" role="group" aria-label="Range">${[30, 90, 365].map((r) => h`<button type="button" data-range="${r}" aria-pressed="${state.range === r}">${r === 365 ? '1Y' : r + 'D'}</button>`)}</div></div>
    <div class="charts" id="charts">${raw(chartsHtml())}</div>
    <p class="xs dim" style="margin-top:6px">Dates before the system’s first live run are reconstructed from historical series (price, ETF flows, OKX OI, funding, DVOL, macro). Order-book depth, aggregate OI and the options surface exist only from the first live run.</p>
    <div class="sec-h" style="margin-top:28px"><h2 style="font-size:12px">Ask the archive</h2></div>
    <div class="qgrid">
      <div class="qlist">${Object.entries(QUERIES).map(([k, q]) => h`<button type="button" data-q="${k}" aria-pressed="${state.query === k}">${q.label}</button>`)}
        <div class="qdates"><input type="date" id="q-a" value="2026-02-05"><span class="dim">→</span><input type="date" id="q-b" value="2026-03-05"></div>
      </div>
      <div class="panel" id="q-out"></div>
    </div>
  </section>`;
}

function chartsHtml() {
  const cut = new Date(Date.now() - state.range * 864e5).toISOString().slice(0, 10);
  const rows = state.rows.filter((r) => r.date >= cut);
  const s = (k) => rows.filter((r) => r[k] !== null && r[k] !== undefined).map((r) => [r.date, r[k]]);
  const etf = new Map(); for (const r of state.rows) if (r.etfDate && r.etfDate >= cut) etf.set(r.etfDate, r.etfLast);
  const etfPts = [...etf.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const usdM = (v) => fmtUsd(v * 1e6, 0);
  return [
    chartShell('BTC price', 'daily · CoinGecko', lineSvg(s('price'), (v) => fmtK(v))),
    chartShell('US spot ETF net flows', 'daily · Farside', barsSvg(etfPts, usdM), '<p class="legend" style="margin:0 0 4px"><span><i style="background:var(--series-pos)"></i>Net inflow</span><span><i style="background:var(--series-neg)"></i>Net outflow</span></p>'),
    chartShell('Open interest (OKX, consistent series)', 'daily · OKX', lineSvg(s('oiOkx'), (v) => fmtUsd(v, 1))),
    chartShell('Perpetual funding (annualised)', 'daily avg · OKX / OI-weighted', lineSvg(s('fundingAnn'), (v) => fmtNum(v, 0) + '%')),
    chartShell('±1% order-book depth (aggregate)', 'per run · exchange books', lineSvg(s('depth1'), (v) => fmtUsd(v, 0))),
    chartShell('Implied volatility (DVOL)', 'daily · Deribit', lineSvg(s('dvol'), (v) => fmtNum(v, 0))),
    chartShell('BTC–Nasdaq 30-day correlation', 'daily returns · derived', lineSvg(s('corrNdx30'), (v) => fmtNum(v, 1))),
    chartShell('US net liquidity (Fed − TGA − RRP)', 'weekly · FRED', lineSvg(s('netLiq'), (v) => fmtUsd(v * 1e9, 1))),
  ].map((x) => x.s).join('');
}

function coverageSection() {
  const a = state.a;
  const st = (q) => chip(q.status === 'server-only' ? 'server value' : q.status, q.status === 'ok' ? 'ok' : q.status === 'error' ? 'err' : 'stale');
  return h`<section id="coverage">
    <div class="sec-h"><h2><span class="n">07</span>Data coverage &amp; methodology</h2><div class="aside">Every number on this page traces to one of these sources. Failed sources keep their last value, marked stale with its original timestamp.</div></div>
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
  const staleN = a.quality.filter((q) => q.status === 'stale' || q.status === 'error').length;
  const old = ageH(a.dataThrough);
  const banners = [];
  if (old !== null && old > 30) banners.push(h`<div class="banner warn">The latest analysis is ${Math.round(old)} hours old. Press <b>Refresh market</b> to update crypto market data in your browser, or start a server run.</div>`);
  const liveN = a.quality.filter((q) => q.status === 'ok').length;
  if (a.kind === 'browser' && liveN < 5) banners.push(h`<div class="banner warn">Browser refresh could reach only ${liveN} of ${a.quality.length} sources from this network (blocked, rate-limited or no cross-origin access). All other values are the last server values, marked stale with their original timestamps. Try again later or start a <b>Server run</b>.</div>`);
  else if (a.kind === 'browser') banners.push(h`<div class="banner">Browser refresh: ${liveN} sources were retrieved live (exchange, derivatives, options and on-chain data where reachable). ETF flows, FRED macro, Yahoo markets and CFTC data cannot be fetched from a browser and show their last server values (marked “server value”). This refresh is not saved to the archive — use <b>Server run</b> for that.</div>`);
  else if (staleN) banners.push(h`<div class="banner warn">${staleN} source(s) could not be refreshed in the last run and show their last known values (marked stale). See <a href="#coverage">Data &amp; method</a>.</div>`);
  $('#app').innerHTML = [h`${banners}`, overview(), forcesSection(), liquiditySection(), scenariosSection(), febSection(), reportSection(), historySection(), coverageSection()].map((x) => x.s).join('');
  wireCharts($('#app'));
  wireSections();
  runQuery();
}

function wireSections() {
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    state.range = +b.dataset.range;
    document.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.range === state.range)));
    $('#charts').innerHTML = chartsHtml();
    wireCharts($('#charts'));
  }));
  document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { state.query = b.dataset.q; document.querySelectorAll('[data-q]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.q === state.query))); runQuery(); }));
  ['#q-a', '#q-b'].forEach((s) => $(s).addEventListener('change', () => { state.query = 'between'; runQuery(); }));
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

function runQuery() {
  const q = QUERIES[state.query];
  const out = $('#q-out');
  if (!q || !out) return;
  if (!state.rows.length) { out.innerHTML = '<p class="muted">No stored history yet.</p>'; return; }
  const r = q.run(state.rows, $('#q-a').value, $('#q-b').value);
  out.innerHTML = h`<h3>${r.title}</h3><ul class="clean">${r.findings.map((f) => h`<li>${f}</li>`)}</ul>${r.table?.length ? h`<div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Metric</th><th class="n">From</th><th class="n">To</th><th class="n">Change</th></tr></thead><tbody>${r.table.map((t) => h`<tr><td>${t.metric}</td><td class="n">${t.from}</td><td class="n">${t.to}</td><td class="n">${t.change}</td></tr>`)}</tbody></table></div>` : ''}`.s;
}

// ---------- data ----------
async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); }

async function load() {
  const [latest, ts, idx] = await Promise.allSettled([getJSON('data/latest.json'), getJSON('data/timeseries.json'), getJSON('data/index.json')]);
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
