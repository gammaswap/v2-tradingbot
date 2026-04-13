import 'dotenv/config';
import { CFG } from "../config/config.js";
import { Wallet } from "ethers";
import axios from "axios";
import {
    validateSignatureJS,
    deriveAccountsFromMnemonic,
    signOrderJS,
    hashClaimOrderJS
} from "../utils/eip712.js";
import { Eip712Claim, OrderType } from "../utils/types.js";

// run with "npx ts-node ./src/sendTestClaim.ts"
async function main() {
    console.log("CHAIN_ID:", CFG.CHAIN_ID);
    console.log("LEDGER_ADDRESS:", CFG.LEDGER_ADDRESS);
    console.log("SETTLEMENT_TOKEN_ADDRESS:", CFG.SETTLEMENT_TOKEN);
    const account = deriveAccountsFromMnemonic(CFG.MNEMONIC, CFG.WALLET_INDEX + 1)[CFG.WALLET_INDEX];
    console.log("Using address:", account.address);

    let epoch = BigInt(CFG.EPOCH);

    if (process.argv.length > 2) {
        if(isNaN(Number(process.argv[2]))) {
            console.log("Invalid epoch provided")
            return
        }
        epoch = BigInt(process.argv[2])
    }

    console.log("epoch:", epoch)

    const claim: Eip712Claim = {
        typ: OrderType.CLAIM,
        nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
        salt: 1n, // this is used to generate a hash which represents the orderId
        signer: account.address,
        signatureType: 0n,
        sender: account.address,
        assetId: BigInt(CFG.ASSET_ID),
        epoch: epoch,
    }

    const chainId = BigInt(CFG.CHAIN_ID)

    const claimHash = hashClaimOrderJS(claim);
    console.log("claimHash:", claimHash)

    const wallet = new Wallet(account.privateKey);

    const signature = signOrderJS(claimHash, wallet)
    console.log("Signature:", signature);

    const recovered = validateSignatureJS(claimHash, signature, wallet.address)
    console.log("isRecovered:", recovered);
    console.log("signer     :", claim.signer.toString());

    const signedMessage = {
        claim: {
            typ: claim.typ.toString(),
            nonce: claim.nonce.toString(), // must be unique in every transaction the user sends
            salt: claim.salt.toString(), // this is used to generate a hash which represents the orderId
            signer: wallet.address,
            signatureType: claim.signatureType.toString(),
            sender: wallet.address,
            assetId: claim.assetId.toString(),
            epoch: claim.epoch.toString(),
        },
        chainId: chainId.toString(),
        orderHash: claimHash,
        signature,
    };

    console.log("signedClaimMessage:", signedMessage);
    try {
        const res = await axios.post(CFG.CLAIM_URL, signedMessage, {
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
