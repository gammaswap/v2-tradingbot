import 'dotenv/config';
import { Wallet } from "ethers";
import axios from "axios";
import {
    hashDepositOrderJS,
    validateSignatureJS,
    deriveAccountsFromMnemonic,
    signOrderJS
} from "../eip712.js";
import { Eip712Deposit } from "../types.js";
import { getPermit2Allowance, isPermit2NonceUsed } from "../blockchain.js";

const CHAIN_ID = process.env.CHAIN_ID || "31337";
const LEDGER_ADDRESS = process.env.LEDGER_CONTRACT || "0x0000000000000000000000000000000000000000";
const SETTLEMENT_TOKEN_ADDRESS = process.env.SETTLEMENT_TOKEN || "0x0000000000000000000000000000000000000000";
const MNEMONIC = process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const PERMIT2_ADDRESS = process.env.PERMIT2_CONTRACT || "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const DEPOSITS_ENDPOINT = process.env.DEPOSITS_ENDPOINT || "http://localhost:3000/deposits";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0")

async function createPermit2Signature(wallet: Wallet, chainId: number, deposit: Eip712Deposit) : Promise<string> {
    const domain = {
        name: "Permit2",             // fixed in Permit2’s EIP712.sol
        chainId,
        verifyingContract: PERMIT2_ADDRESS,
    };

    const types = {
        TokenPermissions: [
            { name: "token",  type: "address" },
            { name: "amount", type: "uint256" },
        ],
        PermitTransferFrom: [
            { name: "permitted", type: "TokenPermissions" },
            { name: "spender",   type: "address" },   // msg.sender in on-chain verify
            { name: "nonce",     type: "uint256" },
            { name: "deadline",  type: "uint256" },
        ],
    };

    const message = {
        permitted: {
            token: deposit.token,
            amount: deposit.amount,
        },
        spender: deposit.ledger,
        nonce: deposit.permitNonce,
        deadline: deposit.expiration,
    };

    console.log("Signing Permit2 typed data...");
    const signature = await wallet.signTypedData(domain, types, message);
    console.log("Signature:", signature);
    return signature
}

// run with "npx ts-node ./src/sendDeposit.ts"
async function main() {
    console.log("CHAIN_ID:", CHAIN_ID);
    console.log("LEDGER_ADDRESS:", LEDGER_ADDRESS);
    console.log("SETTLEMENT_TOKEN_ADDRESS:", SETTLEMENT_TOKEN_ADDRESS);

    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using address:", account.address);

    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 60 * 60; // 1 hour from now

    const deposit: Eip712Deposit = {
        nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
        salt: 1n, // this is used to generate a hash which represents the orderId
        signer: account.address,
        signatureType: 0n,
        sender: account.address,
        expiration: BigInt(expiry),
        amount: 19000000000n,
        token: SETTLEMENT_TOKEN_ADDRESS,
        ledger: LEDGER_ADDRESS,
        permitNonce: BigInt(Date.now()), // must be unique for every permit (needs to be put in the hash of the contract)
        permitSignature: "0x"
    }

    if(await isPermit2NonceUsed(account.address, deposit.permitNonce)) {
        console.log("Permit2 nonce not available!");
        return
    }

    const allowance = await getPermit2Allowance(deposit.sender, deposit.token);
    if (allowance < deposit.amount) {
        console.log(`Insufficient token allowance: allowance < deposit.amount [${allowance.toString()} < ${deposit.amount.toString()}]`);
        return
    }

    const chainId = BigInt(CHAIN_ID)
    deposit.permitSignature = await createPermit2Signature(new Wallet(account.privateKey), Number(chainId), deposit);
    console.log("permitSignature:", deposit.permitSignature);

    const orderHash = hashDepositOrderJS(deposit);
    console.log("orderHash:", orderHash);

    const wallet = new Wallet(account.privateKey);
    console.log("wallet :", wallet.address);

    const signature = signOrderJS(orderHash, wallet)
    console.log("Signature:", signature);

    const recovered = validateSignatureJS(orderHash, signature, wallet.address)
    console.log("isRecovered:", recovered);
    console.log("signer     :", deposit.signer.toString());

    const signedMessage = {
        deposit: {
            nonce: deposit.nonce.toString(), // must be unique in every transaction the user sends
            salt: deposit.salt.toString(), // this is used to generate a hash which represents the orderId
            signer: deposit.signer,
            signatureType: deposit.signatureType.toString(),
            sender: deposit.sender,
            expiration: deposit.expiration.toString(),
            amount: deposit.amount.toString(),
            token: deposit.token.toLowerCase(),
            ledger: deposit.ledger.toLowerCase(),
            permitNonce: deposit.permitNonce.toString(), // must be unique for every permit (needs to be put in the hash of the contract)
            permitSignature: deposit.permitSignature.toLowerCase()
        },
        chainId: chainId.toString(),
        orderHash,
        signature,
    };

    console.log("signedDepositMessage:", signedMessage);
    console.log("DEPOSITS_ENDPOINT:", DEPOSITS_ENDPOINT);

    try {
        const res = await axios.post(DEPOSITS_ENDPOINT, signedMessage, {
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
