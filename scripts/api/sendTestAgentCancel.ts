import "dotenv/config";
import { Wallet, ZeroHash } from "ethers";
import axios from "axios";
import {
  validateSignatureJS,
  signOrderJS,
  hashCancelOrderJS,
  deriveAccountsFromMnemonic,
  Eip712Cancel,
  OrderType,
  SignatureType,
} from "@gammaswap/v2-exchange-sdk";

const CHAIN_ID = process.env.CHAIN_ID || "31337";
const MNEMONIC =
  process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const CANCELS_ENDPOINT = process.env.CANCELS_ENDPOINT || "http://localhost:3000/cancels";
const AGENT_STATUS_ENDPOINT =
  process.env.AGENT_STATUS_ENDPOINT || "http://localhost:3000/agents/status";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const AGENT_INDEX = Number(process.env.AGENT_INDEX || "1");
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

// run with "npx ts-node ./src/sendTestCancel.ts"
// from root run with "pnpm --filter @v2-exchange/exchange-api cancel <orderHash>"
async function main() {
  console.log("CHAIN_ID:", CHAIN_ID);
  const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
  console.log("Using account address:", account.address);
  const agent = deriveAccountsFromMnemonic(MNEMONIC, AGENT_INDEX + 1)[AGENT_INDEX];
  console.log("Using agent address:", agent.address);

  let orderHash;

  if (process.argv.length > 2) {
    orderHash = process.argv[2];
  } else {
    console.log("No orderHash provided");
    return;
  }

  console.log("orderId:", orderHash);

  let approvalNonce = 0n;
  try {
    const res = await axios.get(AGENT_STATUS_ENDPOINT + `/${account.address}`);
    console.log("Server response:", res.status, res.data);
    approvalNonce = BigInt(res.data.nonce);
  } catch (err: any) {
    if (err.response) {
      console.error("Error response:", err.response.status, err.response.data);
    } else {
      console.error("Request error:", err.message);
    }
  }

  const cancel: Eip712Cancel = {
    typ: OrderType.CANCEL,
    nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
    signer: agent.address,
    signatureType: SignatureType.AGENT,
    sender: account.address,
    assetId: BigInt(ASSET_ID),
    epoch: BigInt(EPOCH),
    orderHash: orderHash == "all" ? ZeroHash : orderHash,
    approvalNonce: approvalNonce,
  };

  const chainId = BigInt(CHAIN_ID);

  const cancelHash = hashCancelOrderJS(cancel);
  console.log("cancelHash:", cancelHash);

  const wallet = new Wallet(agent.privateKey);

  const signature = signOrderJS(cancelHash, wallet);
  console.log("Signature:", signature);

  const recovered = validateSignatureJS(cancelHash, signature, wallet.address);
  console.log("isRecovered:", recovered);
  console.log("signer     :", cancel.signer.toString());

  const signedMessage = {
    cancel: {
      typ: cancel.typ.toString(),
      nonce: cancel.nonce.toString(), // must be unique in every transaction the user sends
      signer: cancel.signer.toString(),
      signatureType: cancel.signatureType.toString(),
      sender: cancel.sender.toString(),
      assetId: cancel.assetId.toString(),
      epoch: cancel.epoch.toString(),
      orderHash: cancel.orderHash,
      approvalNonce: cancel.approvalNonce.toString(),
    },
    chainId: chainId.toString(),
    orderHash: cancelHash,
    signature,
  };

  console.log("signedCancelMessage:", signedMessage);
  try {
    const res = await axios.post(CANCELS_ENDPOINT, signedMessage, {
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
