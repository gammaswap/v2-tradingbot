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
