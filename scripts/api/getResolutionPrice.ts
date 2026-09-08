import "dotenv/config";
import axios from "axios";

const RESOLUTION_ENDPOINT = process.env.RESOLUTION_ENDPOINT || "http://localhost:3000/resolve";
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";

// run with "npx ts-node ./src/getResolutionPrice.ts"
async function main() {
  let asset = ASSET_ID;
  let epoch = 0;
  const args = process.argv.slice(2);
  if (args.length > 0) {
    epoch = Number(args[0]); // custom epoch
  }
  if (args.length > 1) {
    asset = args[1]; // custom asset
  }

  try {
    const res = await axios.get(RESOLUTION_ENDPOINT + `/${asset}/${epoch}`);
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
