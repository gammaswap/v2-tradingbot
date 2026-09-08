import "dotenv/config";
import { ethers } from "ethers";
import axios from "axios";
import { deriveAccountsFromMnemonic } from "@gammaswap/v2-exchange-sdk";

const MNEMONIC =
  process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const AGENT_STATUS_ENDPOINT = (process.env.API_URL || "http://localhost:3000") + "/agents/status";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");

// run with "npx ts-node ./src/getBook.ts"
async function main() {
  const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];

  let _account = account.address;
  if (process.argv.length > 2) {
    if (!ethers.isAddress(process.argv[2])) {
      console.log("Invalid epoch provided");
      return;
    }
    _account = process.argv[2];
  }
  console.log("Using address:", _account);

  try {
    const res = await axios.get(AGENT_STATUS_ENDPOINT + `/${_account}`);
    console.log("Server response:", res.status, res.data);
  } catch (err: any) {
    if (err.response) {
      console.error("Error response:", err.response.status, err.response.data);
    } else {
      console.error("Request error:", err.message);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
