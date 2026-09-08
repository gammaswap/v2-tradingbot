import "dotenv/config";
import { Wallet } from "ethers";
import axios from "axios";
import {
  validateSignatureJS,
  signOrderJS,
  hashCancelReplaceOrderJS,
  hashFillOrderJS,
  deriveAccountsFromMnemonic,
  Eip712CancelReplace,
  Eip712Order,
  OrderType,
  SignatureType,
} from "@gammaswap/v2-exchange-sdk";

const CHAIN_ID = process.env.CHAIN_ID || "31337";
const MNEMONIC =
  process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const CANCEL_REPLACE_ENDPOINT =
  (process.env.API_URL || "http://localhost:3000") + "/cancel-replace";
const AGENT_STATUS_ENDPOINT = (process.env.API_URL || "http://localhost:3000") + "/agents/status";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const AGENT_INDEX = Number(process.env.AGENT_INDEX || "1");
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

function parseSide(value: string | undefined): boolean {
  const side = (value || "sell").trim().toLowerCase();
  if (side === "buy") return false;
  if (side === "sell") return true;
  throw new Error(`Invalid side ${value}; expected buy or sell`);
}

function parseTimeInForce(value: string | undefined): bigint {
  const tif = (value || "gtc").trim().toLowerCase();
  if (tif === "gtc") return 0n;
  if (tif === "fok") return 1n;
  if (tif === "ioc") return 2n;
  if (tif === "alo") return 3n;
  throw new Error(`Invalid timeInForce ${value}; expected gtc, fok, ioc, or alo`);
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) return false;

  const flag = value.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "allornothing") return true;
  if (flag === "false" || flag === "0") return false;
  throw new Error(`Invalid allOrNothing ${value}; expected true or false`);
}

// run with "npx ts-node ./src/test/sendTestAgentCancelReplace.ts <cancelOrderHash> <buy|sell> <size> <price> [gtc|fok|ioc|alo] [allOrNothing]"
// from root run with "pnpm --filter @v2-exchange/exchange-api agent:cancel-replace <cancelOrderHash> buy 100000000 500000"
// from root run with "pnpm --filter @v2-exchange/exchange-api agent:cancel-replace <cancelOrderHash> sell 100000000 550000 ioc"
async function main() {
  console.log("CHAIN_ID:", CHAIN_ID);
  const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
  console.log("Using account address:", account.address);
  const agent = deriveAccountsFromMnemonic(MNEMONIC, AGENT_INDEX + 1)[AGENT_INDEX];
  console.log("Using agent address:", agent.address);
  const args = process.argv.slice(2);
  console.log("args:", args);

  const cancelOrderHash = args[0]?.trim().toLowerCase();
  if (!cancelOrderHash) {
    console.log(
      "Usage: agent:cancel-replace <cancelOrderHash> <buy|sell> <size> <price> [gtc|fok|ioc|alo] [allOrNothing]",
    );
    return;
  }

  const replacementSide = parseSide(args[1]);
  const replacementSize =
    args[2] && Number(args[2]) > 0 ? BigInt(Math.floor(Number(args[2]))) : 100_000_000n;
  const replacementPrice =
    args[3] && Number(args[3]) > 0 ? BigInt(Math.floor(Number(args[3]))) : 930000n;
  const replacementTimeInForce = parseTimeInForce(args[4]);
  const allOrNothing = parseBoolean(args[5]);

  let approvalNonce = 0n;
  try {
    const res = await axios.get(AGENT_STATUS_ENDPOINT + `/${account.address}`);
    console.log("Agent status response:", res.status, res.data);
    approvalNonce = BigInt(res.data.nonce);
  } catch (err: any) {
    if (err.response) {
      console.error("Error response:", err.response.status, err.response.data);
    } else {
      console.error("Request error:", err.message);
    }
    return;
  }

  const wallet = new Wallet(agent.privateKey);
  console.log("wallet:", wallet.address);

  const replacement: Eip712Order = {
    typ: OrderType.FILL,
    nonce: BigInt(Date.now()),
    signer: agent.address,
    signatureType: SignatureType.AGENT,
    sender: account.address,
    side: replacementSide,
    assetId: BigInt(ASSET_ID),
    epoch: BigInt(EPOCH),
    size: replacementSize,
    price: replacementPrice,
    timeInForce: replacementTimeInForce,
    approvalNonce,
  };

  const replacementOrderHash = hashFillOrderJS(replacement);
  console.log("replacementOrderHash:", replacementOrderHash);

  const replacementSignature = signOrderJS(replacementOrderHash, wallet);
  console.log("Replacement signature:", replacementSignature);
  console.log(
    "isReplacementRecovered:",
    validateSignatureJS(replacementOrderHash, replacementSignature, wallet.address),
  );

  const cancelReplace: Eip712CancelReplace = {
    typ: OrderType.CANCEL_REPLACE,
    nonce: replacement.nonce + 1n,
    signer: agent.address,
    signatureType: SignatureType.AGENT,
    sender: account.address,
    assetId: BigInt(ASSET_ID),
    epoch: BigInt(EPOCH),
    cancelOrderHash,
    replacementOrderHash,
    approvalNonce,
    allOrNothing,
  };

  const orderHash = hashCancelReplaceOrderJS(cancelReplace);
  console.log("cancelReplaceHash:", orderHash);

  const signature = signOrderJS(orderHash, wallet);
  console.log("Cancel replace signature:", signature);
  console.log(
    "isCancelReplaceRecovered:",
    validateSignatureJS(orderHash, signature, wallet.address),
  );

  const chainId = BigInt(CHAIN_ID);

  const signedMessage = {
    cancelReplace: {
      typ: cancelReplace.typ.toString(),
      nonce: cancelReplace.nonce.toString(),
      signer: cancelReplace.signer.toString(),
      signatureType: cancelReplace.signatureType.toString(),
      sender: cancelReplace.sender.toString(),
      assetId: cancelReplace.assetId.toString(),
      epoch: cancelReplace.epoch.toString(),
      cancelOrderHash: cancelReplace.cancelOrderHash,
      replacementOrderHash: cancelReplace.replacementOrderHash,
      approvalNonce: cancelReplace.approvalNonce.toString(),
      allOrNothing: cancelReplace.allOrNothing,
    },
    replacement: {
      typ: replacement.typ.toString(),
      nonce: replacement.nonce.toString(),
      signer: replacement.signer.toString(),
      signatureType: replacement.signatureType.toString(),
      sender: replacement.sender.toString(),
      side: replacement.side,
      assetId: replacement.assetId.toString(),
      epoch: replacement.epoch.toString(),
      size: replacement.size.toString(),
      price: replacement.price.toString(),
      timeInForce: replacement.timeInForce.toString(),
      approvalNonce: replacement.approvalNonce.toString(),
    },
    chainId: chainId.toString(),
    orderHash,
    signature,
    replacementOrderHash,
    replacementSignature,
  };

  console.log("signedAgentCancelReplaceMessage:", signedMessage);
  try {
    const res = await axios.post(CANCEL_REPLACE_ENDPOINT, signedMessage, {
      headers: {
        "Content-Type": "application/json",
      },
    });
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
