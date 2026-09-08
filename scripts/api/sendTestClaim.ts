import "dotenv/config";
import { Wallet } from "ethers";
import axios from "axios";
import {
  validateSignatureJS,
  signOrderJS,
  hashClaimOrderJS,
  deriveAccountsFromMnemonic,
  Eip712Claim,
  OrderType,
  SignatureType,
} from "@gammaswap/v2-exchange-sdk";

const CHAIN_ID = process.env.CHAIN_ID || "31337";
const MNEMONIC =
  process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const CLAIMS_ENDPOINT = (process.env.API_URL || "http://localhost:3000") + "/claim";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");
const ASSET_ID = process.env.ASSET_ID || "261336857817713630688382311349658711122006440411137";
const EPOCH = process.env.EPOCH || "0";

// run with "npx ts-node ./src/sendTestClaim.ts"
// from root run with "pnpm --filter @v2-exchange/exchange-api claim <epoch>"
async function main() {
  console.log("CHAIN_ID:", CHAIN_ID);
  const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
  console.log("Using address:", account.address);

  let epoch = BigInt(EPOCH);

  if (process.argv.length > 2) {
    if (isNaN(Number(process.argv[2]))) {
      console.log("Invalid epoch provided");
      return;
    }
    epoch = BigInt(process.argv[2]);
  }

  console.log("epoch:", epoch);

  const claim: Eip712Claim = {
    typ: OrderType.CLAIM,
    nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
    signer: account.address,
    signatureType: SignatureType.EOA,
    sender: account.address,
    assetId: BigInt(ASSET_ID),
    epoch: epoch,
    approvalNonce: 0n,
  };

  const chainId = BigInt(CHAIN_ID);

  const claimHash = hashClaimOrderJS(claim);
  console.log("claimHash:", claimHash);

  const wallet = new Wallet(account.privateKey);

  const signature = signOrderJS(claimHash, wallet);
  console.log("Signature:", signature);

  const recovered = validateSignatureJS(claimHash, signature, wallet.address);
  console.log("isRecovered:", recovered);
  console.log("signer     :", claim.signer.toString());

  const signedMessage = {
    claim: {
      typ: claim.typ.toString(),
      nonce: claim.nonce.toString(), // must be unique in every transaction the user sends
      signer: wallet.address,
      signatureType: claim.signatureType.toString(),
      sender: wallet.address,
      assetId: claim.assetId.toString(),
      epoch: claim.epoch.toString(),
      approvalNonce: claim.approvalNonce.toString(),
    },
    chainId: chainId.toString(),
    orderHash: claimHash,
    signature,
  };

  console.log("signedClaimMessage:", signedMessage);
  try {
    const res = await axios.post(CLAIMS_ENDPOINT, signedMessage, {
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
