import "dotenv/config";
import axios from "axios";

const ASSET_ENDPOINT = (process.env.API_URL || "http://localhost:3000") + "/asset";
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";

// run with "npx ts-node ./src/getAsset.ts"
async function main() {
  let asset = ASSET_ID;
  const args = process.argv.slice(2);
  if (args.length > 0) {
    asset = args[0]; // custom asset
  }

  try {
    const res = await axios.get(ASSET_ENDPOINT + `/${asset}`);
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
