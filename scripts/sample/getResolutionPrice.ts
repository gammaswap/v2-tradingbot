import "dotenv/config";
import {
    createInfoClient,
    HttpResponseError,
} from "@gammaswap/v2-exchange-sdk";

const API_URL = process.env.API_URL || "http://localhost:3000";
const ASSET_ID =
    process.env.ASSET_ID ||
    "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

// run with "pnpm sample:resolution-price"
// or "pnpm sample:resolution-price <epoch> <assetId>"
async function main() {
    const client = createInfoClient({
        apiUrl: API_URL,
    });

    let assetId = ASSET_ID;
    let epoch = EPOCH;

    const args = process.argv.slice(2);
    if (args.length > 0) {
        epoch = args[0];
    }
    if (args.length > 1) {
        assetId = args[1];
    }

    try {
        const res = await client.getResolutionPrice({
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
