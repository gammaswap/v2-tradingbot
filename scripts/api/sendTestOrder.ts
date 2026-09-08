import "dotenv/config";
import { Wallet } from "ethers";
import axios from "axios";
import {
  validateSignatureJS,
  signOrderJS,
  hashFillOrderJS,
  deriveAccountsFromMnemonic,
  Eip712Order,
  OrderType,
  SignatureType,
} from "@gammaswap/v2-exchange-sdk";

const CHAIN_ID = process.env.CHAIN_ID || "31337";
const MNEMONIC =
  process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const ORDERS_ENDPOINT = (process.env.API_URL || "http://localhost:3000") + "/orders";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

// run with "npx ts-node ./src/sendTestOrder.ts"
// from root run with "pnpm --filter @v2-exchange/exchange-api order buy 100000000 500000"
// from root run with "pnpm --filter @v2-exchange/exchange-api order buy 100000000 500000 fok"
// from root run with "pnpm --filter @v2-exchange/exchange-api order sell 100000000 550000 ioc"
async function main() {
  console.log("CHAIN_ID:", CHAIN_ID);
  const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
  console.log("Using address:", account.address);
  const args = process.argv.slice(2);
  console.log("args:", args);

  const order: Eip712Order = {
    typ: OrderType.FILL,
    nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
    signer: account.address,
    signatureType: SignatureType.EOA,
    sender: account.address,
    side: true,
    assetId: BigInt(ASSET_ID),
    epoch: BigInt(EPOCH),
    size: 100_000_000n,
    price: 930000n,
    timeInForce: 0n,
    approvalNonce: 0n,
  };

  if (args.length > 0 && args[0].toLowerCase() == "buy") {
    order.side = false;
  }
  if (args.length > 1 && Number(args[1]) > 0) {
    const size = Math.floor(Number(args[1]));
    order.size = BigInt(size);
  }
  if (args.length > 2 && Number(args[2]) > 0) {
    const px = Math.floor(Number(args[2]));
    order.price = BigInt(px);
  }
  if (args.length > 3) {
    const tif = args[3].trim().toLowerCase();
    if (tif == "fok") {
      order.timeInForce = 1n;
    } else if (tif == "ioc") {
      order.timeInForce = 2n;
    }
  }

  const chainId = BigInt(CHAIN_ID);

  const orderHash = hashFillOrderJS(order);
  console.log("orderHash:", orderHash);

  const wallet = new Wallet(account.privateKey);
  console.log("wallet:", wallet.address);

  const signature = signOrderJS(orderHash, wallet);
  console.log("Signature:", signature);

  const recovered = validateSignatureJS(orderHash, signature, wallet.address);
  console.log("isRecovered:", recovered);
  console.log("signer     :", order.signer.toString());

  const signedMessage = {
    order: {
      typ: order.typ.toString(),
      nonce: order.nonce.toString(), // must be unique in every transaction the user sends
      signer: wallet.address,
      signatureType: order.signatureType.toString(),
      sender: wallet.address,
      side: order.side,
      assetId: order.assetId.toString(),
      epoch: order.epoch.toString(),
      size: order.size.toString(),
      price: order.price.toString(),
      timeInForce: order.timeInForce.toString(),
      approvalNonce: order.approvalNonce.toString(),
    },
    chainId: chainId.toString(),
    orderHash,
    signature,
  };

  console.log("signedOrderMessage:", signedMessage);
  try {
    const res = await axios.post(ORDERS_ENDPOINT, signedMessage, {
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
