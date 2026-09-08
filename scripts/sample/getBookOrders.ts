import "dotenv/config";
import { Wallet } from "ethers";
import {
  createInfoClient,
  deriveAccountsFromMnemonic,
  HttpResponseError,
} from "@gammaswap/v2-exchange-sdk";

const API_URL = process.env.API_URL || "http://localhost:3000";
const MNEMONIC =
  process.env.MNEMONIC || "test test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

async function main() {
  const client = createInfoClient({ apiUrl: API_URL });

  const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
  console.log("Using address:", account.address);

  const wallet = new Wallet(account.privateKey);
  console.log("wallet:", wallet.address);

  const res = await client.getBookOrders({
    assetId: ASSET_ID,
    epoch: EPOCH,
    account: wallet.address,
  });

  console.log("Server response:", res.status, res.data);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
