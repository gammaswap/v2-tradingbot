import "dotenv/config";
import {
  decodeAssetId,
  encodeAssetId,
  getExpirationTf,
  parseExpirationTf,
} from "@gammaswap/v2-exchange-sdk/assetIdUtils";

const BASE_ASSET_ID = process.env.BASE_ASSET_ID || "12345678901234567890";
const MARKET_TYPE = Number(process.env.MARKET_TYPE || "1");
const START_TIME = Number(process.env.START_TIME || "1700000000");
const PERIOD_LENGTH = Number(process.env.PERIOD_LENGTH || "900");
const STRIKE = process.env.STRIKE || "50000000";
const RANGE = Number(process.env.RANGE || "0");

// run with "pnpm sample:asset-id"
async function main() {
  const assetId = encodeAssetId(
    BASE_ASSET_ID,
    MARKET_TYPE,
    START_TIME,
    PERIOD_LENGTH,
    STRIKE,
    RANGE,
  );
  const decoded = decodeAssetId(assetId);

  console.log("Encoded asset ID:", assetId.toString());
  console.log("Decoded asset ID:", decoded);
  console.log("Period timeframe:", getExpirationTf(PERIOD_LENGTH));
  console.log('Parsed "15m":', parseExpirationTf("15m"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
