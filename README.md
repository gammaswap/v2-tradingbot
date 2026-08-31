# v2-tradingbot
Trading bot for GammaSwap V2

## Use as a package

Install the package and construct a bot with a wallet and runtime options:

```bash
npm install @gammaswap/v2-tradingbot
```

```ts
import { Wallet } from "ethers";
import { TradingBot } from "@gammaswap/v2-tradingbot";

const bot = new TradingBot({
    wallet: new Wallet(process.env.PRIVATE_KEY!),
    isTaker: false,
    apiUrl: "https://exchange-api.gammaswap.com/api",
    assetId: "261336857817713630688382311349658711122006440411137",
    chainId: 84532,
    contracts: {
        exchange: "0x...",
        ledger: "0x...",
        settlementToken: "0x...",
    },
    quote: {
        levelsPerSide: 5,
        ladderModel: "equidistant",
        logitHalfSpread: 0.5,
    },
    risk: {
        maxContractExposurePct: 5,
    },
});

await bot.start();

process.on("SIGINT", async () => {
    await bot.stop();
});
```

The bot operates in one of two mutually exclusive modes. `isTaker: false`
(the default) runs maker mode: passive ALO quote maintenance only. Setting
`isTaker: true` runs taker mode: the configured aggression strategy and IOC
orders only; passive quote maintenance is disabled. The `IS_TAKER` environment
variable is used when `isTaker` is not supplied. Maker and taker bots should
normally use separate accounts so their balances, inventories, and risk
limits remain independent. `AGGRESSION_MODEL` selects the taker strategy and
supports `edge`, `mean-reversion`, and `edge-with-fallback`.

Each `TradingBot` instance owns its configuration, runtime state, order
intents, cooldowns, and websocket feeds, so multiple independent bots can run
in the same process. The current implementation creates private websocket
connections per bot; websocket multiplexing can be added separately later.

## Strategy configuration

Strategy settings are read from the selected `.env` file. A constructor option
overrides the corresponding environment setting when the bot is used as a
package. Prices are represented internally in protocol price units, where
`1,000` is `0.1` cents (`$0.001`) and `999,000` is `99.9` cents (`$0.999`).
Sizes and inventories are represented internally in protocol size units; one
contract is `1,000,000` units. The descriptions below refer to the current
implementation.

### Choosing maker or taker mode

```env
IS_TAKER=false
```

`IS_TAKER=false` (the default) runs maker mode. The bot maintains passive ALO
quote ladders and does not submit aggression orders. `IS_TAKER=true` runs
taker mode. The bot submits IOC aggression orders and does not maintain a
passive quote ladder. These modes should normally use separate accounts so
their balances, inventories, and risk limits are independent.

### Maker / quoting model

The maker model is a passive market-making strategy. It first chooses a
reference price from the fresh fair value and the order-book midpoint:

```text
referencePrice = FAIR_VALUE_WEIGHT * fairValue
               + (1 - FAIR_VALUE_WEIGHT) * bookMid
```

If the oracle fair value is disabled or unavailable, a fresh order-book
midpoint is required. The reference price is then adjusted for inventory in
logit space:

```text
p = referencePrice / 1,000,000
gamma(t) = gamma_0 + (gamma_max - gamma_0) * (1 - t / T)^B
skew = gamma(t) * inventory * p * (1 - p)
logitCenter = ln(p / (1 - p)) - skew
logitBid = logitCenter - LOGIT_HALF_SPREAD
logitAsk = logitCenter + LOGIT_HALF_SPREAD
```

The logits are converted back to probabilities to produce the initial bid and
ask. Positive inventory creates a positive skew and shifts both quotes lower,
encouraging the bot to reduce a long position. Negative inventory shifts the
quotes higher, encouraging the bot to reduce a short position. The resulting
prices are used to build passive ALO ladder levels and are clamped to the hard
protocol price range.

The ladder can be configured with:

```env
LADDER_PRICE_MODEL=1
LEVELS_PER_SIDE=5
LEVEL_SPACING_NEAR=2000
LEVEL_SPACING_GROWTH=1.5
```

`LADDER_PRICE_MODEL=1` selects the equidistant model. It distributes the
available range evenly across the requested levels. `LADDER_PRICE_MODEL=2`
selects the growth-space model, where successive distances grow by
`LEVEL_SPACING_GROWTH`. Increasing `LEVELS_PER_SIDE` creates more passive
orders; decreasing it creates fewer. `LEVEL_SPACING_NEAR` controls the first
growth-space distance, while `LEVEL_SPACING_GROWTH` controls how quickly later
levels spread out. These spacing settings have no effect when using the
equidistant model.

The ladder range is constrained by the reference price, the usable book
midpoint, and the protocol limits:

```env
HARD_MIN_PRICE=1000
HARD_MAX_PRICE=999000
```

Increasing `HARD_MIN_PRICE` removes lower bid/ask levels from consideration;
decreasing it permits more lower prices, but it can never go below the
protocol minimum. Increasing `HARD_MAX_PRICE` permits higher levels;
decreasing it removes higher levels. These are safety bounds rather than
ordinary strategy preferences. The bot also avoids submitting marketable ALO
bids below the hard minimum or asks above the hard maximum.

The total size assigned to each side is calculated before it is distributed
across the ladder:

```text
H(t) = H_0 * [1 - (1 - t / T)^k]^A
bidSize = max(0, inventoryTarget + H(t) - currentInventory)
askSize = max(0, currentInventory - inventoryTarget + H(t))
```

`H_0` is derived from account balance and `MAX_CONTRACT_EXPOSURE_PCT`; it is
not an independent environment variable. The calculated side total is then
distributed with more quantity on the levels farthest from the best bid or
ask and less quantity near the current price.

The maker sizing settings are:

```env
MAX_CONTRACT_EXPOSURE_PCT=5
TOTAL_SIZE_DECAY_K=2
TOTAL_SIZE_DECAY_A=0.5
TOTAL_SIZE_TIME_BUCKET_SECONDS=5
QUOTE_SIZE_CONCAVITY=1
INV_TARGET=0
INV_MAX_ABS=5000000000
```

- `MAX_CONTRACT_EXPOSURE_PCT` determines the maximum starting contract
  allocation on each side as a percentage of account balance. Increasing it
  permits larger inventory; decreasing it reduces the total quote size. It is
  capped by the configured inventory limit.
- `TOTAL_SIZE_DECAY_K` controls how long the bot stays near full size during
  the epoch. Increasing it keeps size near `H_0` longer and concentrates the
  reduction closer to expiration.
- `TOTAL_SIZE_DECAY_A` controls the collapse near expiration. Values closer to
  zero make the final reduction more abrupt; values closer to one make the
  decay smoother.
- `TOTAL_SIZE_TIME_BUCKET_SECONDS` controls how often the remaining-time
  calculation changes. Increasing it reduces updates but makes the size curve
  coarser; decreasing it makes the curve more responsive.
- `QUOTE_SIZE_CONCAVITY` controls the distribution across levels. `1` is
  approximately linear; values above `1` allocate relatively more to outer
  levels, while values below `1` make the distribution flatter.
- `INV_TARGET` is the signed inventory target. A positive value targets a long
  position; a negative value targets a short position.
- `INV_MAX_ABS` is the maximum absolute signed inventory used by the quote and
  aggression risk checks. Increasing it permits more inventory; decreasing it
  makes the bot reduce or avoid positions sooner.

The quote price risk settings are:

```env
RISK_AVERSION_GAMMA_0=1e-9
RISK_AVERSION_GAMMA_MAX=1e-8
RISK_AVERSION_B=5
LOGIT_HALF_SPREAD=0.5
```

- `RISK_AVERSION_GAMMA_0` is the inventory-risk sensitivity at the beginning
  of an epoch. Increasing it makes inventory skew affect quotes earlier and
  more strongly.
- `RISK_AVERSION_GAMMA_MAX` is the sensitivity near expiration. Increasing it
  makes the bot push quotes farther away from an existing inventory position
  as settlement approaches.
- `RISK_AVERSION_B` controls the timing of the increase. Larger values keep
  gamma closer to `gamma_0` for longer and make the increase more concentrated
  near expiration.
- `LOGIT_HALF_SPREAD` is the half-spread in logit units. Increasing it widens
  the bid/ask separation; decreasing it narrows the separation.

### Taker / aggression model

The taker model is an active strategy. It sends IOC orders that cross the
spread when its selected model recommends a trade. IOC means any unfilled
remainder is cancelled by the exchange; the bot does not maintain a passive
ladder in taker mode.

Select the aggression strategy with:

```env
AGGRESSION_MODEL=edge-with-fallback
```

The supported values are:

- `edge`: uses the oracle-derived fair value when it is fresh. It buys when
  fair value is sufficiently above the best ask and sells when it is
  sufficiently below the best bid. If there is no qualifying edge, it does
  nothing.
- `mean-reversion`: uses the order-book midpoint relative to `CENTER_PRICE`.
  It buys more often below the center and sells more often above the center.
  Inventory skew adjusts the probability to discourage increasing an existing
  position.
- `edge-with-fallback`: tries the fair-value edge model first and uses the
  mean-reversion model when no fair-value edge is available.

The fair-value edge threshold is configured with:

```env
FAIR_VALUE_MIN_EDGE_TICKS=2
```

Increasing this value requires a larger edge before an IOC trade is sent and
reduces aggression. Decreasing it makes trades possible with smaller edges.
This setting affects the `edge` portion of the aggression model; it does not
change the maker fair-value calculation.

The mean-reversion settings are:

```env
CENTER_PRICE=500000
MEANREV_K=2
INV_SKEW_STRENGTH=0.35
EXTREME_PUSH_PROB=0.10
```

- `CENTER_PRICE` is the protocol price around which the mean-reversion model
  operates. Increasing it makes more market prices appear below center and
  therefore increases the model's tendency to buy; decreasing it has the
  opposite effect.
- `MEANREV_K` controls the strength of the response to the midpoint’s distance
  from center. Increasing it makes the buy/sell probability move more quickly
  toward its directional extreme; decreasing it makes the response weaker.
- `INV_SKEW_STRENGTH` controls the inventory correction in the aggression
  probability. Increasing it more strongly favors selling when long and buying
  when short. Zero disables this probability adjustment.
- `EXTREME_PUSH_PROB` is the probability of reversing the normal mean-reversion
  recommendation. Setting it to `0` disables that reversal and leaves only
  mean reversion plus inventory correction. A value greater than `0` and less
  than `1` introduces probabilistic outward, momentum-like trades. It applies
  to the mean-reversion fallback, not to the fair-value edge decision.

Aggression timing and order sizing are configured with:

```env
AGGRESS_MS=300000
AGGRESS_JITTER_MS=12000
WIPE_LEVELS=2
SLIP_BUFFER=0.15
MAX_AGGRESS_QTY=500000000
```

- `AGGRESS_MS` is the base delay between aggression attempts. Increasing it
  reduces trading frequency; decreasing it allows checks more often.
- `AGGRESS_JITTER_MS` adds a random timing adjustment to the base delay.
  Increasing it makes attempts less predictable; setting it to zero removes
  the timing variation.
- `WIPE_LEVELS` determines how many opposing book levels are included when
  sizing an IOC order. Increasing it targets more depth and potentially larger
  trades; decreasing it targets less depth.
- `SLIP_BUFFER` adds quantity beyond the observed opposing depth to account for
  the book changing before submission. Increasing it requests more quantity;
  decreasing it requests less.
- `MAX_AGGRESS_QTY` is the hard maximum quantity for one aggression order.
  Increasing it permits larger IOC orders, subject to the other risk and
  protocol limits; decreasing it caps them sooner.

### Shared risk and fair-value settings

These settings can affect either mode:

```env
USE_ORACLE_FAIR_VALUE=true
FAIR_VALUE_VOL=0.80
FAIR_VALUE_WEIGHT=1.0
FAIR_VALUE_PAYS_ABOVE_STRIKE=true
REQUIRE_FRESH_FAIR_VALUE=true
FAIR_VALUE_STALE_MS=45000
MAX_CAPITAL_EXPOSURE_PERCENT=70
BASE_RESERVE_MIN=1500000000
```

`USE_ORACLE_FAIR_VALUE` enables the oracle fair-value model. When disabled,
maker reference pricing uses the fresh book midpoint and taker aggression uses
its configured non-oracle model. `FAIR_VALUE_VOL` controls the volatility
input to the fair-value probability: higher volatility generally makes the
probability less sensitive to the spot/strike difference, while lower
volatility makes it more decisive. `FAIR_VALUE_WEIGHT` controls how much the
maker reference price follows the oracle value versus the book midpoint.
Increasing it favors the oracle; decreasing it favors the book. The same fair
value is used by the taker edge model.

`FAIR_VALUE_PAYS_ABOVE_STRIKE` chooses whether the market pays when the
underlying finishes above or below the strike. `REQUIRE_FRESH_FAIR_VALUE`
pauses trading when an oracle fair value is required but unavailable.
`FAIR_VALUE_STALE_MS` defines freshness using the age of
`STATE.fairValue.updatedAtMs`; increasing it allows older fair values, while
decreasing it makes the bot pause sooner.

`MAX_CAPITAL_EXPOSURE_PERCENT` limits the percentage of account collateral
available to the order planner. `BASE_RESERVE_MIN` is an absolute balance floor
that remains unavailable. Increasing either setting generally permits more
orders; decreasing either makes collateral checks more restrictive. These
settings limit available collateral and are separate from the contract-count
limit controlled by `MAX_CONTRACT_EXPOSURE_PCT`.

## Run multiple bots with PM2

Install PM2 globally with Node.js 20 or newer:

```bash
npm install pm2@latest -g
```

The repository includes `bots.config.cjs`, which starts the bot profiles
through the shared `trading_bot.sh` script. Each profile selects its own
environment file, such as `.env.asset1`, `.env.asset2`, or `.env.asset3`:

```bash
pm2 start bots.config.cjs
```

Start only selected bots with `--only`:

```bash
pm2 start bots.config.cjs --only asset1-bot
pm2 start bots.config.cjs --only asset1-bot,asset2-bot
```

Manage the bots independently by name:

```bash
pm2 list
pm2 logs asset1-bot
pm2 restart asset2-bot
pm2 stop asset1-bot asset2-bot asset3-bot
```

Each bot is configured with a 30-second `kill_timeout`. When stopped with
`pm2 stop`, PM2 sends `SIGINT`, allowing the bot to stop its coordinator,
close its feeds, submit cancel-all requests, and verify pending orders before
exiting. The timeout gives that cleanup enough time to complete. PM2 will
eventually force-kill a process that does not exit within the configured
timeout.

PM2 writes each bot's output to a dedicated directory configured in
`bots.config.cjs`:

```text
logs/maker1-bot.log
logs/maker1-bot-error.log
logs/taker1-bot.log
logs/taker1-bot-error.log
logs/maker2-bot.log
logs/maker2-bot-error.log
logs/taker2-bot.log
logs/taker2-bot-error.log
logs/maker3-bot.log
logs/maker3-bot-error.log
logs/taker3-bot.log
logs/taker3-bot-error.log
```

The shell script does not redirect output itself. It forwards stdout and
stderr to PM2, which owns these files. Install PM2's optional log-rotation
module to rotate them daily and when they reach 100 MB:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:rotateInterval "0 0 * * *"
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

The active log files remain in `logs/`; rotated files receive date-based
suffixes and older compressed files are retained according to the configured
retention count. Recreate existing PM2 processes after changing
`bots.config.cjs` so PM2 loads the new output paths:

```bash
pm2 delete maker1-bot taker1-bot maker2-bot taker2-bot maker3-bot taker3-bot
pm2 start bots.config.cjs
```
