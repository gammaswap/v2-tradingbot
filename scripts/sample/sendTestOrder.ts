import "dotenv/config";
import { Wallet } from "ethers";
import {
  createExchangeClient,
  deriveAccountsFromMnemonic,
  OrderSide,
  TimeInForce,
} from "@gammaswap/v2-exchange-sdk";
import { getConfiguredContracts } from "../../src/api/api.js";

const API_URL = process.env.API_URL || "http://localhost:3000";
const CHAIN_ID = process.env.CHAIN_ID || "31337";
const MNEMONIC =
  process.env.MNEMONIC || "test test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

function parseSide(value: string | undefined): boolean {
  const side = (value || "sell").trim().toLowerCase();
  if (side === "buy") return OrderSide.BUY;
  if (side === "sell") return OrderSide.SELL;
  throw new Error(`Invalid side ${value}; expected buy or sell`);
}

function parseTimeInForce(value: string | undefined): bigint {
  const tif = (value || "gtc").trim().toLowerCase();
  if (tif === "gtc") return TimeInForce.GTC;
  if (tif === "fok") return TimeInForce.FOK;
  if (tif === "ioc") return TimeInForce.IOC;
  throw new Error(`Invalid timeInForce ${value}; expected gtc, fok, or ioc`);
}

async function main() {
  console.log("CHAIN_ID:", CHAIN_ID);

  const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
  console.log("Using address:", account.address);

  const wallet = new Wallet(account.privateKey);
  console.log("wallet:", wallet.address);

  const args = process.argv.slice(2);
  console.log("args:", args);

  const side = parseSide(args[0]);
  const size = args[1] || "100";
  const price = args[2] || "93";
  const timeInForce = parseTimeInForce(args[3]);

  const client = createExchangeClient({
    apiUrl: API_URL,
    wallet,
    chainId: CHAIN_ID,
    contracts: getConfiguredContracts(),
  });

  const res = await client.placeOrder({
    assetId: ASSET_ID,
    epoch: EPOCH,
    side,
    size,
    price,
    timeInForce,
  });

  console.log("signedOrderMessage:", res.request);
  console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
