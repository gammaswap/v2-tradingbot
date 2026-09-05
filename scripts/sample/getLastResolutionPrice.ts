import "dotenv/config";
import {
    createInfoClient,
    HttpResponseError,
} from "@gammaswap/v2-exchange-sdk";

const API_URL = process.env.API_URL || "http://localhost:3000";
const ASSET_ID =
    process.env.ASSET_ID ||
    "261336857817713630688382311349658711122006440411137";

// run with "pnpm sample:last-resolution-price"
// or "pnpm sample:last-resolution-price <assetId>"
async function main() {
    const client = createInfoClient({
        apiUrl: API_URL,
    });

    let assetId = ASSET_ID;

    const args = process.argv.slice(2);
    if (args.length > 0) {
        assetId = args[0];
    }

    try {
        const res = await client.getLastResolutionPrice(assetId);

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
