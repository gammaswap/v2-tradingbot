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
