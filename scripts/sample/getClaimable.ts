import "dotenv/config";
import {
  createInfoClient,
  deriveAccountsFromMnemonic,
  HttpResponseError,
} from "@gammaswap/v2-exchange-sdk";

const API_URL = process.env.API_URL || "http://localhost:3000";
const MNEMONIC =
  process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

// run with "pnpm sample:claimable"
// or "pnpm sample:claimable <epoch> <assetId> <account>"
async function main() {
  const client = createInfoClient({ apiUrl: API_URL });
  const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX].address;
  const args = process.argv.slice(2);
  const epoch = args[0] || EPOCH;
  const assetId = args[1] || ASSET_ID;
  const claimAccount = args[2] || account;

  try {
    const res = await client.getClaimable({
      account: claimAccount,
      assetId,
      epoch,
    });
    console.log("Server response:", res.status, res.data);
  } catch (err: unknown) {
    if (err instanceof HttpResponseError) {
      console.error("Error response:", err.status, err.data);
    } else if (err instanceof Error) {
      console.error("Request error:", err.message);
    } else {
      console.error("Request error:", err);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
