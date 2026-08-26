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

The package API currently supports one bot instance per process because the
existing runtime maintains shared configuration and state internally.
