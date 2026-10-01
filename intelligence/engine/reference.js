// Curated, sourced reference library: the January–February 2026 case study and
// historical analogues. These are documented facts (with sources) and clearly
// marked interpretations — not model output. Where published figures conflict,
// both are shown and the conflict is stated.

export const FEB2026 = {
  id: 'feb2026',
  title: 'January–February 2026 liquidity drawdown',
  window: { start: '2026-01-14', end: '2026-02-06' },
  summary:
    'BTC fell from roughly $90K in mid/late January to an intraday low near $60K on 5 February 2026 (≈$63K on a daily-close basis), ' +
    'about 50% below the October 2025 all-time high. The move combined a macro-policy shock (hawkish Fed-chair nomination) with a market ' +
    'that was already structurally weakened: three months of ETF redemptions, materially thinner order books than at the October 2025 peak, ' +
    'and leveraged long positioning that was liquidated in two waves (30–31 January and 5 February).',
  chain: [
    {
      step: 'Fed / liquidity concern',
      text: 'On 30 January 2026 Kevin Warsh was nominated as Fed Chair. Markets read him as favouring tighter policy, higher real rates and further balance-sheet reduction — i.e. a lower expected path for dollar liquidity.',
      evidence: [
        { text: 'BTC fell ~7% from ~$84.6K to ~$78.7K after the nomination; ~$2.4–2.5B of long liquidations, the largest of 2026 at that time.', source: 'Yahoo Finance / CoinDesk reporting', url: 'https://finance.yahoo.com/news/bitcoin-slides-below-80k-warsh-095916858.html' },
      ],
    },
    {
      step: 'Risk-off sentiment',
      text: 'Cross-asset de-risking; analysts described a "perfect storm" of leverage, ETF outflows and a risk-off macro backdrop. On 5 February Treasury Secretary Bessent testified he had "no authority to stabilize crypto markets".',
      evidence: [
        { text: 'Kronos Research CIO quoted: "forced liquidations from over-leveraged longs, ETF/institutional outflows, and a broader risk-off macro backdrop".', source: 'Forbes / CoinDesk reporting, 5 Feb 2026', url: 'https://www.forbes.com/sites/digital-assets/2026/02/05/bitcoin-suddenly-plunges-as-panic-selling-accelerates-price-crash-fears/' },
      ],
    },
    {
      step: 'Already-weakened market',
      text: 'BTC entered the episode ~30% below its October 2025 high after a failed recovery; the 10 October 2025 cascade had already removed a large share of market-making capacity and risk appetite.',
      evidence: [
        { text: 'US spot BTC ETFs lost a record ~$4.57B over November–December 2025.', source: 'CoinDesk, 2 Jan 2026', url: 'https://www.coindesk.com/markets/2026/01/02/bitcoin-etfs-lose-record-usd4-57-billion-in-two-months' },
      ],
    },
    {
      step: 'ETF outflows',
      text: 'Redemptions resumed in January: ~$1.1B over 6–8 January, −$817.9M on 29 January, and three consecutive weekly outflows into the week ending 6 February (−$358.5M that week).',
      evidence: [
        { text: 'Jan 6: −$243M; Jan 7: −$486M; Jan 8: −$399M.', source: 'CoinDesk, 9 Jan 2026', url: 'https://www.coindesk.com/markets/2026/01/09/bitcoin-etf-optimism-fades-as-three-day-outflows-streak-erases-early-month-gains' },
        { text: 'Jan 29: −$817.87M; January net ≈ −$1.1B. Week ending 6 Feb: −$358.5M (third consecutive weekly outflow).', source: 'Farside / press reporting', url: 'https://farside.co.uk/bitcoin-etf-flow-all-data/' },
        { text: 'Conflicting claim excluded: some outlets reported "nearly $10B" of BTC+ETH ETF outflows in a single day after the nomination. This is inconsistent with issuer-level flow data and is not used.', source: 'Editorial note', url: null },
      ],
    },
    {
      step: 'Reduced market depth',
      text: 'Displayed order-book liquidity was far below 2025 levels, so each dollar of forced selling moved price more.',
      evidence: [
        { text: 'Binance BTC 1% market depth exceeded $600M at the October 2025 high and had fallen below $400M; aggregated 2% depth ≈30% below its 2025 high.', source: 'Kaiko data via CryptoSlate', url: 'https://cryptoslate.com/bitcoin-struggles-to-reclaim-90000-amid-plummeting-liquidity-and-waning-market-depth/' },
      ],
    },
    {
      step: 'Leveraged positioning',
      text: 'Long-biased leverage had rebuilt during January’s attempted recovery toward $95K.',
      evidence: [
        { text: 'Two liquidation waves dominated by longs (see next step). Pre-event funding/OI-to-market-cap readings are not documented in the sources used here — treat the leverage build-up as reported, not measured by this system.', source: 'Editorial note', url: null },
      ],
    },
    {
      step: 'Liquidation cascade',
      text: 'On 5 February BTC fell ~17% in 24h to ~$60K (7:20 p.m. ET), liquidating ~$2.67B of positions in 24h, ~$2.31B of them longs; ~$817M liquidated in four hours.',
      evidence: [
        { text: '$2.67B total / $2.31B long liquidations in 24h; partial rebound to ~$64.1K.', source: 'CoinDesk / Yahoo Finance reporting, 5–6 Feb 2026', url: 'https://finance.yahoo.com/news/bitcoin-flash-crashes-60-000-020734460.html' },
        { text: 'Contested interpretation: at least one analysis argued the final leg was not primarily leverage- or exchange-driven (pointing to off-exchange/ETF-related selling). Leverage clearly amplified, but its share of causation is disputed.', source: 'Yahoo Finance analysis', url: 'https://finance.yahoo.com/news/bitcoin-drop-60k-didn-t-120739653.html' },
      ],
    },
    {
      step: 'Further forced selling',
      text: 'Thin books + liquidation sell orders + negative-gamma hedging and stop-losses produced price gaps; China’s ban on yuan-pegged stablecoins (6 Feb) added headline pressure. Price stabilised only once leverage had been flushed.',
      evidence: [
        { text: 'BTC printed its lowest level since October 2024, ~52% below the all-time high.', source: 'Press reporting, 6 Feb 2026', url: 'https://www.coindesk.com/markets/2026/06/07/bitcoin-near-usd60-000-today-vs-february-institutional-mood-is-starkly-different' },
      ],
    },
  ],
  // Reference states used for the daily structural comparison.
  reference: {
    drawdownFromAthPct: -35, // entering the episode (≈$84–90K vs ≈$126K ATH); interpretation
    etfConsecutiveOutflowWeeks: 3,
    binanceDepth1PctUsd: 400e6, // "under $400M" (Kaiko)
    depthVsPeakPct: -30,
    liquidationWaveUsd: 2.5e9,
  },
};

export const ANALOGUES = [
  {
    id: 'oct2025',
    date: '2025-10-10',
    label: 'October 2025 tariff shock — record leverage cascade',
    type: 'Reflexive liquidation cascade',
    trigger: 'Announcement of 100% tariffs on Chinese imports (≈2 p.m. ET, 10 Oct), late on a Friday with thin weekend-approaching liquidity.',
    mechanism: 'Exogenous macro shock hit a market at record open interest near the all-time high. Market makers pulled quotes, auto-deleveraging and liquidation engines sold into empty books, altcoins gapped far more than BTC.',
    data: '≈$19B liquidated in 24h (≈$16.7B longs), >$7B in one hour; BTC −~8% toward ~$112K on aggregate prices (some venues printed far lower wicks); total crypto market cap −≈$400B.',
    lesson: 'Leverage level matters more than the size of the trigger. Displayed depth disappeared exactly when needed; post-event, depth and market-maker capacity did not fully recover for months.',
    sources: [{ name: 'Business Today / CoinGlass data', url: 'https://www.businesstoday.in/personal-finance/investment/story/crypto-crash-19-bn-wiped-out-as-trumps-100-china-tariff-sparks-largest-liquidation-in-history-497823-2025-10-11/' }],
  },
  {
    id: 'feb2026',
    date: '2026-02-05',
    label: 'January–February 2026 — macro shock into a weakened, thin market',
    type: 'Spot outflows + long liquidation, cascade on the final leg',
    trigger: 'Hawkish Fed-chair nomination (30 Jan) and risk-off; persistent ETF redemptions.',
    mechanism: 'See the full case study. Distinctive feature: the selling was not only leverage — ETF redemptions and thin depth meant spot selling had outsized price impact before leverage amplified it.',
    data: '~$90K → ~$60K intraday (5 Feb); ~$2.5B and ~$2.7B liquidation waves; three consecutive weekly ETF outflows.',
    lesson: 'Persistent outflows + thin depth + rebuilt long leverage is the dangerous combination; any one alone was not sufficient.',
    sources: [{ name: 'See case-study sources', url: null }],
  },
  {
    id: 'jun2026',
    date: '2026-06-03',
    label: 'June 2026 — ETF outflow streak + treasury-company selling + geopolitics',
    type: 'Spot-driven decline with long liquidations',
    trigger: 'Strategy confirmed its first BTC sale since 2022; US–Iran talks broke down; ETF outflow streak (13 consecutive sessions by 3 June).',
    mechanism: 'Supply from a perceived "never-sell" holder changed the marginal-buyer assumption; ETF redemptions removed the main spot bid; longs were liquidated as price fell from ~$73K to below $60K later in the month.',
    data: 'Reported liquidation totals conflict ($1.86B vs >$3B in 24h depending on source/window). ETF −$396.6M on 3 June.',
    lesson: 'A spot-led decline can reach February-type lows without a February-type leverage cascade; institutional flows differed (see CoinDesk comparison).',
    sources: [
      { name: 'KuCoin daily report, 3 Jun 2026', url: 'https://www.kucoin.com/news/articles/crypto-daily-market-report-june-3-2026?lang=en_US' },
      { name: 'CoinDesk, 7 Jun 2026', url: 'https://www.coindesk.com/markets/2026/06/07/bitcoin-near-usd60-000-today-vs-february-institutional-mood-is-starkly-different' },
    ],
  },
  {
    id: 'sep2026',
    date: '2026-09-21',
    label: 'September 2026 — ETF-led spot recovery with falling leverage',
    type: 'Spot-demand-driven rally',
    trigger: 'Return of US ETF demand and broader risk appetite.',
    mechanism: 'Price rose while aggregate OI fell — buying was funded with cash, not leverage. This is the textbook signature of a spot-led move: slower, but less prone to reflexive reversal.',
    data: 'ETF inflow of ~$999M on 21 Sep (largest daily of 2026); ~$2.39B in the week to 25 Sep; BTC above $87K (highest since January); total BTC OI fell from >$25B to ~$21B.',
    lesson: 'Rallies without leverage build-up have better structural quality; the risk shifts to whether ETF demand persists.',
    sources: [
      { name: 'CryptoRank / The Coin Republic, 27 Sep 2026', url: 'https://www.thecoinrepublic.com/2026/09/27/bitcoin-etf-inflows-hit-2026-record-as-btc-price-holds-above-84k/' },
      { name: 'Coincall market note, 23 Sep 2026', url: 'https://support.coincall.com/hc/en-us/articles/62537612343833-September-23-2026-Bitcoin-Reclaims-86K-as-ETF-Inflows-Surge-and-Risk-Appetite-Returns' },
    ],
  },
  {
    id: 'mar2020',
    date: '2020-03-12',
    label: 'March 2020 — COVID dash-for-cash',
    type: 'Macro liquidity crisis + liquidation cascade',
    trigger: 'Global scramble for dollars; equities, gold and credit all sold.',
    mechanism: 'Cross-asset margin calls forced selling of every liquid asset; BitMEX liquidation engine and exchange outages left books empty. BTC traded as a high-beta liquidity asset, not a hedge.',
    data: 'BTC fell roughly 50% in two days (≈$7.9K → ≈$3.8K intraday).',
    lesson: 'In a true dollar-liquidity crisis correlations go to one; the recovery came only after the Fed flooded dollar liquidity.',
    sources: [{ name: 'Widely documented; exchange data', url: null }],
  },
  {
    id: 'may2021',
    date: '2021-05-19',
    label: 'May 2021 — China mining ban + leverage flush',
    type: 'Reflexive liquidation cascade',
    trigger: 'Chinese regulatory crackdown on mining and trading; ESG headlines.',
    mechanism: 'Very high funding and OI after the April peak; long liquidations cascaded through thin weekend books.',
    data: 'BTC fell ≈50% from the April high to ≈$30K intraday on 19 May.',
    lesson: 'Persistently elevated funding is a warning about positioning fragility, not a timing signal.',
    sources: [{ name: 'Widely documented', url: null }],
  },
  {
    id: 'jul2021',
    date: '2021-07-26',
    label: 'July 2021 — short squeeze',
    type: 'Short squeeze',
    trigger: 'Rally through a range top while funding was negative.',
    mechanism: 'Shorts crowded into a range; a move through resistance forced buy-backs, which pushed price through further short stops.',
    data: 'Roughly $1B of shorts liquidated in a day; BTC +≈15% intraday toward $40K.',
    lesson: 'Negative funding + rising OI near a range top is the setup for upside acceleration.',
    sources: [{ name: 'Widely documented', url: null }],
  },
  {
    id: 'nov2022',
    date: '2022-11-08',
    label: 'November 2022 — FTX collapse',
    type: 'Credit / counterparty event (spot-led decline)',
    trigger: 'Insolvency of a major exchange.',
    mechanism: 'Counterparty fear drove withdrawals and spot selling; market-making capacity (Alameda) disappeared, permanently lowering depth for months.',
    data: 'BTC fell ≈25% to ≈$15.5K within days.',
    lesson: 'Liquidity providers themselves can be the shock; depth may not recover quickly.',
    sources: [{ name: 'Widely documented', url: null }],
  },
  {
    id: 'q1-2024',
    date: '2024-03-14',
    label: 'Q1 2024 — spot ETF launch rally',
    type: 'Spot-demand-driven rally',
    trigger: 'US spot ETF launch (11 Jan 2024) and persistent creations.',
    mechanism: 'Daily ETF creations repeatedly exceeded new issuance; authorised participants bought spot, absorbing exchange supply.',
    data: 'BTC rose from ≈$46K to a then-record ≈$73K by mid-March 2024.',
    lesson: 'Persistent, multi-week flows matter far more than single large days.',
    sources: [{ name: 'Farside flow history', url: 'https://farside.co.uk/bitcoin-etf-flow-all-data/' }],
  },
];

// Data the system cannot observe from free primary sources. Displayed explicitly.
export const UNAVAILABLE = [
  { metric: 'Exchange BTC balances / exchange net flows', why: 'Requires an on-chain entity-labelling provider (Glassnode, CryptoQuant, Coin Metrics Pro). Shown if the free Coin Metrics tier returns flow metrics.' },
  { metric: 'SOPR, LTH/STH supply, dormancy, realized P/L, whale cohorts', why: 'Requires Glassnode/CryptoQuant (paid). Not estimated.' },
  { metric: 'Aggregated liquidation history & observed liquidation heatmaps', why: 'CoinGlass/Kaiko require keys. This system shows OKX liquidations (sample) and a clearly-labelled model estimate of liquidation zones.' },
  { metric: 'CME futures open interest (live) and CME basis', why: 'No free real-time API. Weekly CFTC Commitments of Traders positioning is used instead.' },
  { metric: 'ETF assets under management / holdings', why: 'Issuer pages are not machine-readable reliably. BTC exposure implied by daily flows is computed instead.' },
  { metric: 'IBIT / CME options positioning', why: 'Not available free. Options analytics are Deribit-only (the largest crypto-native venue).' },
  { metric: 'Executed (vs displayed) liquidity at depth', why: 'Requires tick-level trade + book data (Kaiko). Displayed depth is shown with that caveat.' },
];
