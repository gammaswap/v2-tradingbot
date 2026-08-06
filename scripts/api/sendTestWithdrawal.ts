import 'dotenv/config';
import { Wallet } from "ethers";
import axios from "axios";
import {
    validateSignatureJS,
    signOrderJS,
    hashWithdrawalOrderJS,
    deriveAccountsFromMnemonic,
    getCurrentTime,
    Eip712Withdrawal,
    OrderType,
    SignatureType
} from "@gammaswap/v2-exchange-sdk";

const CHAIN_ID = process.env.CHAIN_ID || "31337";
const LEDGER_ADDRESS = process.env.LEDGER_CONTRACT || "0x0000000000000000000000000000000000000000";
const MNEMONIC = process.env.TEST_MNEMONIC || "test test test test test test test test test test test junk";
const WITHDRAWALS_ENDPOINT = process.env.WITHDRAWALS_ENDPOINT || "http://localhost:3000/withdrawals";
const WALLET_INDEX = Number(process.env.WALLET_INDEX || "0")

// run with "npx ts-node ./src/sendTestWithdrawal.ts"
async function main() {
    console.log("CHAIN_ID:", CHAIN_ID);
    console.log("LEDGER_ADDRESS:", LEDGER_ADDRESS);
    const account = deriveAccountsFromMnemonic(MNEMONIC, WALLET_INDEX + 1)[WALLET_INDEX];
    console.log("Using address:", account.address);

    const now = getCurrentTime();
    const expiry = now + 60n * 60n; // 1 hour from now

    const withdrawal: Eip712Withdrawal = {
        typ: OrderType.WITHDRAWAL,
        nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
        signer: account.address,
        signatureType: SignatureType.EOA,
        sender: account.address,
        receiver: account.address,
        amount: 1_000_000_000n,
        ledger: LEDGER_ADDRESS
    }

    const chainId = BigInt(CHAIN_ID)

    const makerPk = account.privateKey;
    const wallet = new Wallet(makerPk);
    console.log("wallet:", wallet.address);

    const orderHash = hashWithdrawalOrderJS(withdrawal);
    console.log("orderHash:", orderHash);

    const signature = signOrderJS(orderHash, wallet)
    console.log("Signature:", signature);

    const recovered = validateSignatureJS(orderHash, signature, wallet.address)
    console.log("isRecovered:", recovered);
    console.log("signer     :", withdrawal.signer.toString());

    const signedMessage = {
        withdrawal: {
            typ: withdrawal.typ.toString(),
            nonce: withdrawal.nonce.toString(), // must be unique in every transaction the user sends
            signer: withdrawal.sender,
            signatureType: withdrawal.signatureType.toString(),
            sender: withdrawal.sender,
            receiver: withdrawal.receiver,
            amount: withdrawal.amount.toString(),
            ledger: withdrawal.ledger
        },
        chainId: chainId.toString(),
        orderHash,
        signature,
    };

    console.log("signedWithdrawalMessage:", signedMessage);
    try {
        const res = await axios.post(WITHDRAWALS_ENDPOINT, signedMessage, {
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
