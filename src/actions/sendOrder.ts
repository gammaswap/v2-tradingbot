import 'dotenv/config';
import { CFG } from "../config/config.js";
import { Wallet } from "ethers";
import axios from "axios";
import {
    hashFillOrderJS,
    validateSignatureJS,
    deriveAccountsFromMnemonic,
    signOrderJS
} from "../utils/eip712.js";
import { Eip712Order, OrderType } from "../utils/types.js";

// run with "npx ts-node ./src/sendTestOrder.ts"
// from root run with "yarn order buy 100000000 500000"
// from root run with "yarn order sell 100000000 550000"
async function main() {
    console.log("CHAIN_ID:", CFG.CHAIN_ID);
    console.log("LEDGER_ADDRESS:", CFG.LEDGER_ADDRESS);
    console.log("SETTLEMENT_TOKEN_ADDRESS:", CFG.SETTLEMENT_TOKEN);
    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    console.log("Using address:", account.address);
    const args = process.argv.slice(2);
    console.log("args:", args);

    const order: Eip712Order = {
        typ: OrderType.FILL,
        nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
        salt: 1n, // this is used to generate a hash which represents the orderId
        signer: account.address,
        signatureType: 0n,
        sender: account.address,
        side: true,
        assetId: BigInt(CFG.ASSET_ID),
        epoch: BigInt(CFG.EPOCH),
        size: 100_000_000n,
        price: 530000n,
    }

    if(args.length > 0 && args[0].toLowerCase() == "buy") {
        order.side = false;
    }
    if(args.length > 1 && Number(args[1]) > 0) {
        const size = Math.floor(Number(args[1]))
        order.size = BigInt(size);
    }
    if(args.length > 2 && Number(args[2]) > 0) {
        const px = Math.floor(Number(args[2]))
        order.price = BigInt(px);
    }

    const chainId = BigInt(CFG.CHAIN_ID)

    const orderHash = hashFillOrderJS(order);
    console.log("orderHash:", orderHash);

    const wallet = new Wallet(account.privateKey);
    console.log("wallet:", wallet.address);

    const signature = signOrderJS(orderHash, wallet)
    console.log("Signature:", signature);

    const recovered = validateSignatureJS(orderHash, signature, wallet.address)
    console.log("isRecovered:", recovered);
    console.log("signer     :", order.signer.toString());

    const signedMessage = {
        order: {
            typ: order.typ.toString(),
            nonce: order.nonce.toString(), // must be unique in every transaction the user sends
            salt: order.salt.toString(), // this is used to generate a hash which represents the orderId
            signer: wallet.address,
            signatureType: order.signatureType.toString(),
            sender: wallet.address,
            side: order.side,
            assetId: order.assetId.toString(),
            size: order.size.toString(),
            price: order.price.toString()
        },
        chainId: chainId.toString(),
        orderHash,
        signature,
    };

    console.log("signedOrderMessage:", signedMessage);
    try {
        const res = await axios.post(CFG.ORDERS_URL, signedMessage, {
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
