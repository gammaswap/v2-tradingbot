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

Each `TradingBot` instance owns its configuration, runtime state, order
intents, cooldowns, and websocket feeds, so multiple independent bots can run
in the same process. The current implementation creates private websocket
connections per bot; websocket multiplexing can be added separately later.
