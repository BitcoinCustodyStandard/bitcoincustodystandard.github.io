// Plain-English explanations behind the "i" icons. Each entry has the same shape:
//   what    — what the number measures (1–2 sentences, any jargon explained inline)
//   why     — why it matters for the cycle or short-term behaviour
//   now(a)  — how to read today's reading/zone, built from the analysis (no new figures)
//   history — one sentence of historical context (optional)
//   caveat  — data or interpretation limits (optional)
// Rendered as 3–5 short sentences; entries that describe cycle zones end with the
// standard reminder. Tone: calm, educational, never predictive.

import { fmtNum, fmtPct, fmtUsdSigned } from './util.js';
import { ZONES } from './cycle.js';

export const REMINDER = 'This is historical context, not a prediction.';

const cyM = (a, id) => a.cycle?.metrics?.find((x) => x.id === id);
const force = (a, id) => a.forces?.find((f) => f.id === id);
// "1.5–2.4" style range of the zone a value sits in
function range(table, label, unit = '') {
  const i = table.findIndex((z) => z.label === label);
  if (i < 0) return '';
  return i === 0 ? `below ${table[1].min}${unit}` : i === table.length - 1 ? `${table[i].min}${unit} and above` : `${table[i].min}–${table[i + 1].min}${unit}`;
}
const ZONE_MEANS = {
  mvrv: { 'Deep value': 'the average holder is at a loss — historically where long cycles have bottomed', Value: 'holders are only modestly in profit', 'Neutral / mid-cycle': 'a moderate profit — not cheap, but well short of the extremes seen at past tops', Elevated: 'large unrealised profits, which have historically encouraged selling', Euphoria: 'very large unrealised profits, the level seen near past cycle tops' },
  nupl: { Capitulation: 'the average holder is underwater', 'Hope / Fear': 'holders are back to small profits', 'Optimism / Anxiety': 'holders are in profit, but not euphoric', 'Belief / Denial': 'profits are large and confidence is high', 'Euphoria / Greed': 'profits are extreme' },
  sopr: { 'Loss realisation': 'sellers are, on average, locking in losses — often a sign of capitulation or shake-outs', 'Near breakeven': 'a balance point where neither profit-taking nor panic selling dominates', 'Heavy profit-taking': 'sellers are locking in sizeable profits' },
};

export const EXPLAIN = {
  mvrv: {
    title: 'MVRV ratio',
    what: 'MVRV compares Bitcoin’s price with the average price at which all coins last moved on-chain — the network’s average “cost basis”.',
    why: 'It shows how much profit the typical holder is sitting on.',
    now: (a) => { const x = cyM(a, 'mvrv'); return x?.value ? `Today’s ${x.display} is in the “${x.zone.label}” zone (${range(ZONES.mvrv, x.zone.label)}): ${ZONE_MEANS.mvrv[x.zone.label]}.` : null; },
    history: 'Past cycle tops came above roughly 3–4; major bottoms below 1.',
    reminder: true,
  },
  nupl: {
    title: 'NUPL',
    what: 'NUPL (net unrealised profit/loss) is the share of Bitcoin’s market value that is paper profit not yet sold.',
    why: 'It is calculated directly from MVRV, so it tells the same story on a simpler scale.',
    now: (a) => { const x = cyM(a, 'nupl'); return x?.value !== undefined && x?.value !== null ? `${x.display} is the “${x.zone.label}” band (${range(ZONES.nupl, x.zone.label)}): ${ZONE_MEANS.nupl[x.zone.label]}.` : null; },
    history: 'Above 0.75 has often appeared near cycle tops; below zero near major bottoms.',
    reminder: true,
  },
  sopr: {
    title: 'SOPR',
    what: 'SOPR (spent output profit ratio) looks only at coins that actually moved and asks whether their sellers took a profit or a loss, on average.',
    why: 'Above 1 means a profit; below 1, a loss.',
    now: (a) => { const x = cyM(a, 'sopr'); return x?.value ? `The 7-day average of ${x.display} is “${x.zone.label}”: ${ZONE_MEANS.sopr[x.zone.label]}.` : null; },
    history: 'Sustained readings well above 1 have accompanied heavy profit-taking.',
    caveat: (a) => (cyM(a, 'sopr')?.status === 'delayed' ? `The free data runs about a week behind (latest ${cyM(a, 'sopr').asOf}).` : null),
  },
  composite: {
    title: 'Composite valuation index',
    what: 'Averages five valuation readings, each scored from −2 (stretched) to +2 (deep value).',
    why: 'Combining several metrics avoids leaning on any single one.',
    now: (a) => { const v = a.cycle?.valuation; if (!v?.zone) return null; const ext = (v.inputs || []).filter((x) => Math.abs(x.score) === 2).length; return `Today’s ${v.score > 0 ? '+' : ''}${fmtNum(v.score, 1)} is “${v.zone.label}”${v.zone.label.startsWith('Neutral') ? `: ${ext ? 'readings offset each other' : 'no input is at an extreme'}, so valuation gives no edge either way` : ''}.`; },
    reminder: true,
  },
  'force:options': {
    title: 'Options positioning & volatility',
    what: 'Tracks Deribit, the largest Bitcoin options exchange: where large contracts cluster, and how much movement traders are paying for (implied volatility, or “IV”).',
    why: 'Dealers hedge options by trading bitcoin, so big clusters (“gamma”) can hold price near a strike or speed up a break through it.',
    now: (a) => { const O = a.metrics?.options, f = force(a, 'options'); return O && f ? `${f.direction.charAt(0).toUpperCase() + f.direction.slice(1)} today: IV of ${fmtNum(O.atmIv30, 0)}% is ${O.ivRvSpread < 0 ? 'below' : 'above'} the ${fmtNum(O.atmIv30 - O.ivRvSpread, 0)}% that price actually moved, so options look ${O.ivRvSpread < 0 ? 'calm, not fearful' : 'nervous'}.` : null; },
    caveat: () => 'Public data can’t fully confirm whether dealers dampen or amplify moves.',
  },
  'force:etf': {
    title: 'ETF demand',
    what: 'Net money flowing into US spot Bitcoin ETFs (exchange-traded funds that hold real bitcoin); new shares mean the fund must buy coins.',
    why: 'It is the clearest daily window into demand from traditional investors.',
    now: (a) => { const E = a.metrics?.etf; return E ? `${E.s5 >= 0 ? 'Still buying' : 'Net selling'}: ${fmtUsdSigned(E.s5 * 1e6, 0)} over 5 days${E.accel < 0 ? `, slower than the ${fmtUsdSigned(E.s20 * 1e6)} of the past 20 days` : ''}.` : null; },
    history: 'Persistent multi-week inflows have accompanied the strongest rallies since these ETFs launched in 2024.',
  },
  level: {
    title: 'Liquidity level',
    now: (a, l) => (l ? levelNow(l) : null),
    why: 'Hedging and forced buying or selling here can slow a move (“pinning”) or speed it up (“acceleration”).',
    caveat: () => 'Liquidation figures are model estimates; dealer positioning can’t always be confirmed from public data.',
  },
};

function levelNow(l) {
  const parts = [];
  if (/short-squeeze/i.test(l.what)) parts.push('estimated short positions that would be force-closed (bought back) above it');
  if (/long-liquidation/i.test(l.what)) parts.push('estimated leveraged long positions that would be force-sold below it');
  if (/options/i.test(l.what) || /gamma/i.test(l.what)) parts.push('a large cluster of options contracts');
  if (/put-strike/i.test(l.what)) parts.push('put options whose hedging can add selling into a decline');
  if (/congestion/i.test(l.what)) parts.push('a price area where Bitcoin traded on many days last year');
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const what = parts.length ? `This band holds ${list}.` : `This band holds: ${l.what}.`;
  const how = l.kind === 'two' ? '“Two-sided” means it could slow a move first, then speed it up if broken.' : l.kind === 'acc' ? 'If reached, forced flows here would tend to speed the move up.' : l.kind === 'spot' ? 'Price is inside this band now, so hedging can hold price in place or amplify a break.' : 'Buyers or hedgers here would tend to slow the move.';
  return [what, how];
}

// → { title, parts: [[sentences…] per paragraph], text: all sentences } or null
// Paragraphs: what it measures + why · how to read today · history / caveats · reminder.
export function explain(key, a, ctx) {
  const e = EXPLAIN[key];
  if (!e) return null;
  const val = (v) => (typeof v === 'function' ? v(a, ctx) : v);
  const now = val(e.now);
  const [lead, reading] = Array.isArray(now) ? [[now[0], e.why], [now[1]]] : [[e.what, e.why], [now]];
  const parts = [lead, reading, [e.history, val(e.caveat)], [e.reminder ? REMINDER : null]].map((p) => p.filter(Boolean)).filter((p) => p.length);
  return { title: ctx?.label ? `${e.title} · ${ctx.label}` : e.title, parts, text: parts.flat() };
}
