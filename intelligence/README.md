# Bitcoin Market Intelligence

A persistent research system that explains, every day, **which forces are driving Bitcoin's price, how they interact, where liquidity and positioning are concentrated, and what conditions could produce materially higher or lower prices**. It is not a trading signal: no recommendations, price targets or probabilities.

- **Page:** `https://bitcoincustodystandard.org/intelligence/` (works on phone, tablet, desktop)
- **Agent:** GitHub Actions workflow `market-intel` — 07:00 every morning in `INTEL_TZ`, plus on demand
- **Archive:** `intelligence/data/` — every run is kept; nothing is overwritten except the "latest" pointers

## How it works

```
collect (engine/collect.js)  →  merge with last snapshot (stale-labelling)
   →  analyze vs stored history (engine/analyze.js)
   →  morning report (engine/report.js)  [+ optional Claude analyst narrative]
   →  persist: timeseries row, history/<date>.json, reports/<date>.md, latest.json
   →  commit → GitHub Pages republishes the page
```

The **same engine** runs in the agent (Node 22) and in the browser. The page's **Refresh market** button re-collects exchange, derivatives, options and on-chain data directly from source APIs in your browser and regenerates the full analysis in place. Sources that block browser requests (Farside ETF flows, FRED, Yahoo, CFTC) keep their last server values, labelled with their own timestamps. **Server run** triggers the full agent (all sources, archived) via `workflow_dispatch`.

### Schedule and time zone

GitHub cron is UTC and has no daylight-saving awareness, so the workflow runs in two slots (10:45 and 11:45 UTC). The agent's gate waits until exactly 07:00 in `INTEL_TZ` in the correct slot and the other slot exits. GitHub can delay scheduled jobs under load; if the 07:00 slot starts late, the report is generated as soon as it starts (until 11:00 local). To change the time zone set the repository variable `INTEL_TZ` (Settings → Secrets and variables → Actions → Variables), e.g. `Europe/London`.

### Optional: analyst narrative

If the repository secret `ANTHROPIC_API_KEY` is set, each run adds an analyst narrative written by Claude (`claude-opus-5-5`) from the computed analysis only. It is constrained to the numbers in the input, must separate observation from interpretation, and may not predict prices. Without the key, the deterministic report is complete on its own.

## Data sources

| Area | Source | Frequency | Notes |
|---|---|---|---|
| Price, market cap, history | CoinGecko (fallback Coinbase candles) | intraday / daily | |
| Order-book depth | Coinbase, Kraken, Bitstamp, OKX, Binance, Bybit public books | snapshot per run | ±0.5/1/2% USD depth, imbalance, venue share, impact simulation |
| Perp/futures OI, funding | OKX, Binance, Bybit, Deribit, BitMEX, Hyperliquid | snapshot; 8h funding | Binance/Bybit often geo-block US servers → shown as unavailable |
| OI history, long/short, taker flow | OKX Trading Data | daily | single-venue consistent series |
| CME positioning | CFTC Traders in Financial Futures (code 133741) | weekly | |
| Basis curve | Deribit dated futures vs index | snapshot | |
| Options | Deribit (OI, IV, skew, gamma, max pain), DVOL | snapshot / daily | excludes CME and IBIT options |
| ETF flows | Farside Investors | daily | per fund, US$m |
| Macro | FRED: WALCL, WTREGEN, RRPONTSYD, WRESBAL, DFF, DGS2, DGS10, DFII10, T10YIE, DTWEXBGS, BAMLH0A0HYM2, VIXCLS, NASDAQCOM, SP500, ECBASSETSW, JPNASSETS, FX | daily/weekly/monthly | |
| Cross-asset | Yahoo Finance: gold & silver futures, DXY, Nasdaq-100, S&P 500, VIX, 10y | daily | |
| On-chain | Coin Metrics Community (MVRV, realised cap, hash rate, miner revenue), mempool.space, DefiLlama stablecoins | daily | |

**ETF fallback:** if Farside blocks the runner, add rows to `intelligence/data/manual/etf_flows.csv` (`date,total_usd_m,IBIT,FBTC,...`, US$ millions). They fill missing dates only and are labelled as manual in the source table.

**Not available from free sources (shown explicitly on the page):** exchange balances and entity-labelled flows, SOPR/LTH/STH/dormancy/whale cohorts, aggregated liquidation history and observed heatmaps, live CME OI/basis, ETF AUM, IBIT/CME options, executed (vs displayed) depth.

## Methodology

**Never mixing methodologies silently.** Aggregate OI changes are computed only against history with the same venue set; otherwise the OKX daily series is used and labelled "OKX-only proxy". Depth changes likewise require the same venue set. Funding is normalised to an 8-hour rate and OI-weighted.

**Observed vs interpretation.** Every force shows *Current state (observed)*, *Evidence* (value · source · timestamp · frequency, or "Derived by this system"), *Transmission mechanism*, *Interpretation (analysis)*, change vs yesterday and vs one week ago, *what would invalidate it* and *what to watch*.

**Force ranking** = magnitude of the current change × structural relevance (e.g. ETF flows weighted by persistence; macro weighted by BTC's current correlation with equities). The score orders the list; it is not a forecast.

**Regime** (spot-, leverage-, derivatives-, macro- or liquidity-led) is scored from explicit thresholds (`T` in `engine/analyze.js`):

| Threshold | Value |
|---|---|
| Funding "hot" / "extreme" | > 15% / > 30% annualised |
| Leverage build / flush (7d OI) | > +8% / < −8% |
| Strong ETF demand | \|5-day net\| > $750M |
| Depth deterioration | ±1% depth < −15% vs 7 days earlier |
| High / low correlation | > 0.5 / < 0.15 (30-day) |

**Move attribution** classifies the last 24h and 7d as spot-driven rally, leverage-driven rally, short squeeze, spot-driven decline, leveraged long liquidation, reflexive liquidation cascade, or range variants, from price change × OI change × funding × ETF flows × depth change × liquidations. The label states how complete its inputs were.

**Liquidity map ($5K bands).** For each band: displayed book liquidity (only observable within ~±3%), **modelled** liquidation concentrations, Deribit option OI and near-dated gamma, days traded in the band over the past year (congestion), and markers (ETF flow-weighted basis, 200-day average, realised price). Tags use the language "potential acceleration zone / liquidity vacuum / short-squeeze zone / long-liquidation zone".

**Liquidation model (estimate, not data).** Leverage added on days when OKX OI rose (scaled to aggregate OI) is placed at that day's close, split long/short by the OKX account ratio, across a 5×/10×/25×/50× mix (25/35/25/15%) with 0.5% maintenance margin; positions whose liquidation price has already been crossed by the subsequent price path are removed. It locates *plausible* clusters; it does not observe them.

**Options.** Gamma from Black-Scholes with Deribit mark IV, expressed as $ hedge change per 1% move. Dealer sign is not observable, so the page states both possibilities (pinning if dealers are long gamma, acceleration if short).

**Scenarios** list what must happen first (with today's status), confirming and contradicting indicators, acceleration levels from the map, the liquidity mechanism and the failure condition. No probabilities.

## Asking the archive

From a checkout:

```bash
node intelligence/agent/query.mjs between 2026-02-05 2026-03-05   # what changed between two dates
node intelligence/agent/query.mjs selloff     # what preceded the last ≥15% selloff
node intelligence/agent/query.mjs liquidity   # when liquidity began deteriorating
node intelligence/agent/query.mjs etf         # when ETF flows turned
node intelligence/agent/query.mjs funding     # when funding became extreme
node intelligence/agent/query.mjs oi          # when OI began increasing
node intelligence/agent/query.mjs decouple    # when BTC decoupled from the Nasdaq
```

On the first run the agent **backfills ~1 year** of daily rows from series that carry history (price, ETF flows, OKX OI, funding, DVOL, macro, MVRV, stablecoins, BTC–Nasdaq correlation). Order-book depth, aggregate OI and the options surface cannot be backfilled from free sources and accumulate from the first live run.

## Files

```
intelligence/
  index.html, assets/          the page
  engine/                      collect · analyze · report · history queries · reference library (shared by page and agent)
  agent/run.mjs                the daily agent;  agent/narrate.mjs  optional Claude narrative
  agent/query.mjs              archive questions (CLI);  agent/test/offline.mjs  synthetic end-to-end test
  data/latest.json             current analysis (what the page shows)
  data/snapshot.json           last raw snapshot (for stale carry-forward)
  data/timeseries.json         one row per day — the queryable history (feeds the daily charts)
  data/runs.json               one point per agent run — depth, aggregate OI, Coinbase premium charts
  data/history/<id>.json       full analysis for every run (<date> = 07:00 report, <date>-HHMM = refresh)
  data/reports/<id>.md         the morning report as Markdown
  data/index.json              archive index
```

Run locally: `cd intelligence/agent && npm ci && node run.mjs` (live) or `node test/offline.mjs` (synthetic data, writes to a temp dir only).

## Market Battlefield (`/intelligence/battlefield/`)

A real-time visualization of market structure: bulls stand on resting bids, bears on resting asks, the front line is the aggregated mid-price, formations scale with displayed order-book liquidity, $50 price bands holding ≥4× the median band and ≥$2M appear as labelled champions (walls), large aggressive trades arc into the front line, and liquidations explode in the ranks of the side that was liquidated.

- **Live mode** connects from the browser to public exchange WebSockets: Coinbase Advanced Trade (level2, trades, ticker), Kraken v2 (1000-level book, trades, ticker), OKX (spot book, spot + perp trades, all-SWAP liquidations, funding, OI) and Binance (spot trades; USDⓈ-M liquidations, which some regions block). No keys, no server.
- **Replay mode** plays back real feed data recorded by the `battle-record` workflow (`intelligence/battlefield/record.mjs` → `replay.json`). It is used automatically if live feeds cannot be reached, and in previews that cannot open connections.
- **Observed vs modeled.** Price, 24h change, walls, book imbalance, liquidations, large trades, funding, OI and spot volume are observed (with venue coverage stated). The pressure index, army strength, liquidation zones (from the daily model) and front-line momentum are labelled as modeled.
- Coinbase trade aggressor side is inferred from execution price versus the book mid; Kraken, OKX and Binance report it directly.
