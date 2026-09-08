import "dotenv/config";
import axios from "axios";

const ORDERBOOK_ENDPOINT = (process.env.API_URL || "http://localhost:3000") + "/book";
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

// run with "npx ts-node ./src/getBook.ts"
async function main() {
  try {
    const res = await axios.get(ORDERBOOK_ENDPOINT + `/${ASSET_ID}/${EPOCH}`);
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
