import 'dotenv/config';
import { Wallet } from "ethers";
import axios from "axios";
import {
    validateSignatureJS,
    signOrderJS,
    hashApproveAgentOrderJS,
    hashAgentApprovalJS,
    deriveAccountsFromMnemonic,
    Eip712AgentApproval,
    Eip712ApproveAgent,
    OrderType,
    SignatureType
} from "@gammaswap/v2-exchange-sdk";

const CHAIN_ID = process.env.CHAIN_ID || "31337";
const MNEMONIC = process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const AGENT_APPROVE_ENDPOINT = process.env.AGENT_APPROVE_ENDPOINT || "http://localhost:3000/agents/approve";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0");

// run with "npx ts-node ./src/sendTestClaim.ts"
// from root run with "pnpm --filter @v2-exchange/exchange-api agent:approve"
async function main() {
    console.log("CHAIN_ID:", CHAIN_ID);
    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using account address:", account.address);

    let agentIndex = WALLET_INDEX + 1;
    if (process.argv.length > 2) {
        if(isNaN(Number(process.argv[2]))) {
            console.log("Invalid epoch provided")
            return
        }
        agentIndex = Number(process.argv[2])
    }

    const agent = deriveAccountsFromMnemonic(MNEMONIC, agentIndex + 1)[agentIndex];
    console.log("Using agent address:", agent.address);
    const agentWallet = new Wallet(agent.privateKey);

    const approval: Eip712AgentApproval = {
        master: account.address.toLowerCase(),
        agent: agent.address.toLowerCase(),
        approvalNonce: BigInt(Date.now() + 150000) / 1000n,
        approvalSignature: "",
    };

    const wallet = new Wallet(account.privateKey);

    const approvalHash = hashAgentApprovalJS(approval);
    console.log("approvalHash:", approvalHash)
    approval.approvalSignature = signOrderJS(approvalHash, wallet);
    console.log("approvalSignature:", approval.approvalSignature)

    const approveAgent: Eip712ApproveAgent = {
        typ: OrderType.AGENT_APPROVE,
        nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
        signer: account.address,
        signatureType: SignatureType.EOA,
        sender: account.address,
        agent: agent.address,
        approvalNonce: approval.approvalNonce,
        approvalSignature: approval.approvalSignature,
    }

    const chainId = BigInt(CHAIN_ID)

    const approveAgentHash = hashApproveAgentOrderJS(approveAgent);
    console.log("approveAgentHash:", approveAgentHash)

    const signature = signOrderJS(approveAgentHash, wallet)
    console.log("Signature:", signature);

    const recovered = validateSignatureJS(approveAgentHash, signature, wallet.address)
    console.log("isRecovered:", recovered);
    console.log("signer     :", approveAgent.signer.toString());

    const signedMessage = {
        approval: {
            typ: approveAgent.typ.toString(),
            nonce: approveAgent.nonce.toString(), // must be unique in every transaction the user sends
            signer: approveAgent.signer.toString(),
            signatureType: approveAgent.signatureType.toString(),
            sender: approveAgent.sender.toString(),
            agent: approveAgent.agent.toString(),
            approvalNonce: approveAgent.approvalNonce.toString(),
            approvalSignature: approveAgent.approvalSignature.toString(),
        },
        chainId: chainId.toString(),
        orderHash: approveAgentHash,
        signature,
    };

    console.log("signedApproveAgentMessage:", signedMessage);
    try {
        const res = await axios.post(AGENT_APPROVE_ENDPOINT, signedMessage, {
            headers: {
                "Content-Type": "application/json",
            },
        });
        console.log("Server response:", res.status, res.data);
    } catch (err: any) {
        if (err.response) {
            console.error(
                "Error response:",
                err.response.status,
                err.response.data
            );
        } else {
            console.error("Request error:", err.message);
        }
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
