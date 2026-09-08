import "dotenv/config";
import { Wallet } from "ethers";
import axios from "axios";
import {
  validateSignatureJS,
  signOrderJS,
  hashRevokeAgentOrderJS,
  deriveAccountsFromMnemonic,
  Eip712RevokeAgent,
  OrderType,
  SignatureType,
} from "@gammaswap/v2-exchange-sdk";

const CHAIN_ID = process.env.CHAIN_ID || "31337";
const MNEMONIC =
  process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const AGENT_REVOKE_ENDPOINT = (process.env.API_URL || "http://localhost:3000") + "/agents/revoke";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");

// run with "npx ts-node ./src/sendTestRevoke.ts"
// from root run with "pnpm --filter @v2-exchange/exchange-api agent:revoke"
async function main() {
  console.log("CHAIN_ID:", CHAIN_ID);
  const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
  console.log("Using account address:", account.address);

  const wallet = new Wallet(account.privateKey);

  const revokeAgent: Eip712RevokeAgent = {
    typ: OrderType.AGENT_REVOKE,
    nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
    signer: account.address,
    signatureType: SignatureType.EOA,
    sender: account.address,
  };

  const chainId = BigInt(CHAIN_ID);

  const revokeAgentHash = hashRevokeAgentOrderJS(revokeAgent);
  console.log("revokeAgentHash:", revokeAgentHash);

  const signature = signOrderJS(revokeAgentHash, wallet);
  console.log("Signature:", signature);

  const recovered = validateSignatureJS(revokeAgentHash, signature, wallet.address);
  console.log("isRecovered:", recovered);
  console.log("signer     :", revokeAgent.signer.toString());

  const signedMessage = {
    revocation: {
      typ: revokeAgent.typ.toString(),
      nonce: revokeAgent.nonce.toString(), // must be unique in every transaction the user sends
      signer: revokeAgent.signer.toString(),
      signatureType: revokeAgent.signatureType.toString(),
      sender: revokeAgent.sender.toString(),
    },
    chainId: chainId.toString(),
    orderHash: revokeAgentHash,
    signature,
  };

  console.log("signedRevokeAgentMessage:", signedMessage);
  try {
    const res = await axios.post(AGENT_REVOKE_ENDPOINT, signedMessage, {
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
