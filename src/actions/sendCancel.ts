import 'dotenv/config';
import { CFG } from "../config/config.js";
import { Wallet } from "ethers";
import axios from "axios";
import {
    hashCancelOrderJS,
    validateSignatureJS,
    deriveAccountsFromMnemonic,
    signOrderJS
} from "../utils/eip712.js";
import { Eip712Cancel } from "../utils/types.js";

// run with "npx ts-node ./src/sendCancel.ts"
async function main() {
    console.log("CHAIN_ID:", CFG.CHAIN_ID);
    console.log("LEDGER_ADDRESS:", CFG.LEDGER_ADDRESS);
    console.log("SETTLEMENT_TOKEN_ADDRESS:", CFG.SETTLEMENT_TOKEN);
    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    console.log("Using address:", account.address);

    let orderHash;

    if (process.argv.length > 2) {
        orderHash = process.argv[2]
    } else {
        console.log("No orderHash provided")
        return
    }

    console.log("orderId:", orderHash)

    const cancel: Eip712Cancel = {
        typ: 3n,
        nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
        salt: 1n, // this is used to generate a hash which represents the orderId
        signer: account.address,
        signatureType: 0n,
        sender: account.address,
        assetId: BigInt(CFG.ASSET_ID),
        orderHash: orderHash
    }

    const chainId = BigInt(CFG.CHAIN_ID)

    const cancelHash = hashCancelOrderJS(cancel);
    console.log("cancelHash:", cancelHash)

    const wallet = new Wallet(account.privateKey);

    const signature = signOrderJS(cancelHash, wallet)
    console.log("Signature:", signature);

    const recovered = validateSignatureJS(cancelHash, signature, wallet.address)
    console.log("isRecovered:", recovered);
    console.log("signer     :", cancel.signer.toString());

    const signedMessage = {
        cancel: {
            typ: cancel.typ.toString(),
            nonce: cancel.nonce.toString(), // must be unique in every transaction the user sends
            salt: cancel.salt.toString(), // this is used to generate a hash which represents the orderId
            signer: wallet.address,
            signatureType: cancel.signatureType.toString(),
            sender: wallet.address,
            assetId: cancel.assetId.toString(),
            orderHash: cancel.orderHash,
        },
        chainId: chainId.toString(),
        orderHash: cancelHash,
        signature,
    };

    console.log("signedCancelMessage:", signedMessage);
    console.log("CANCELS_URL:", CFG.CANCELS_URL);

    try {
        const res = await axios.post(CFG.CANCELS_URL, signedMessage, {
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
    }/**/
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
