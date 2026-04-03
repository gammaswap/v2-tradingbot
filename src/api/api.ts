import crypto from "crypto";
import { CFG, type Side } from "../config/config.js";
import {
    ApiBalancesResponse,
    ApiBookResponse,
    ApiPendingResponse,
    ApiPositionResponse,
    Eip712Cancel,
    Eip712Order
} from "../utils/types.js";
import { Wallet } from "ethers";
import { hashCancelOrderJS, hashFillOrderJS, signOrderJS, validateSignatureJS } from "../utils/eip712.js";

function buildHeaders(body?: any): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (CFG.API_KEY) h["X-API-KEY"] = CFG.API_KEY;

    // Placeholder signature scheme — replace with your real scheme if needed
    if (CFG.API_SECRET && body != null) {
        const payload = JSON.stringify(body);
        const sig = crypto.createHmac("sha256", CFG.API_SECRET).update(payload).digest("hex");
        h["X-SIGNATURE"] = sig;
    }
    return h;
}

async function httpGetJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { method: "GET", headers: buildHeaders() });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}

async function httpPostJson<T>(url: string, body: any): Promise<T> {
    const res = await fetch(url, { method: "POST", headers: buildHeaders(body), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}

export async function apiGetBook(epoch: number): Promise<ApiBookResponse> {
    return httpGetJson<ApiBookResponse>(CFG.BOOK_URL + "/" + CFG.ASSET_ID + "/" + epoch);
}

export async function apiGetBalance(): Promise<ApiBalancesResponse> {
    return httpGetJson<ApiBalancesResponse>(CFG.BALANCE_URL + "/" + CFG.USER_ADDRESS);
}

export async function apiGetPosition(epoch: number): Promise<ApiPositionResponse> {
    return httpGetJson<ApiPositionResponse>(CFG.POSITION_URL + "/" + CFG.USER_ADDRESS + "/" + CFG.ASSET_ID + "/" + epoch);
}

export async function apiGetPending(address: string, epoch: number): Promise<ApiPendingResponse> {
    return httpGetJson<ApiPendingResponse>(CFG.PENDING_URL + "/" + CFG.ASSET_ID + `/${epoch}/` + address.toLowerCase());
}

export async function apiSendOrder(wallet: Wallet, order: { epoch: number, side: Side; price: number; size: number }) {

    const eip712Order: Eip712Order = {
        typ: 2n,
        nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
        salt: 1n, // this is used to generate a hash which represents the orderId
        signer: wallet.address,
        signatureType: 0n,
        sender: wallet.address,
        side: order.side != "buy",
        assetId: BigInt(CFG.ASSET_ID),
        epoch: BigInt(order.epoch),
        size: BigInt(order.size),
        price: BigInt(order.price),
    }

    const chainId = BigInt(CFG.CHAIN_ID)

    const orderHash = hashFillOrderJS(eip712Order);
    console.log("orderHash:", orderHash);

    const signature = signOrderJS(orderHash, wallet)
    console.log("Signature:", signature);

    const recovered = validateSignatureJS(orderHash, signature, eip712Order.sender)
    console.log("isRecovered:", recovered);
    console.log("signer     :", eip712Order.signer.toString());

    const signedMessage = {
        order: {
            typ: eip712Order.typ.toString(),
            nonce: eip712Order.nonce.toString(), // must be unique in every transaction the user sends
            salt: eip712Order.salt.toString(), // this is used to generate a hash which represents the orderId
            signer: eip712Order.signer,
            signatureType: eip712Order.signatureType.toString(),
            sender: eip712Order.sender,
            side: eip712Order.side,
            assetId: eip712Order.assetId.toString(),
            epoch: eip712Order.epoch.toString(),
            size: eip712Order.size.toString(),
            price: eip712Order.price.toString()
        },
        chainId: chainId.toString(),
        orderHash,
        signature,
    };

    console.log("signedOrderMessage:", signedMessage);
    // Generic payload — adjust to match your API schema
    return httpPostJson<any>(CFG.ORDERS_URL, signedMessage);
}

export async function apiCancelOrder(wallet: Wallet, epoch: number, orderHash: string) {

    console.log("orderId:", orderHash)

    const cancel: Eip712Cancel = {
        typ: 3n,
        nonce: BigInt(Date.now()), // must be unique in every transaction the user sends
        salt: 1n, // this is used to generate a hash which represents the orderId
        signer: wallet.address,
        signatureType: 0n,
        sender: wallet.address,
        assetId: BigInt(CFG.ASSET_ID),
        epoch: BigInt(epoch),
        orderHash: orderHash
    }

    const chainId = BigInt(CFG.CHAIN_ID)

    const cancelHash = hashCancelOrderJS(cancel);
    console.log("cancelHash:", cancelHash)

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
            epoch: cancel.epoch.toString(),
            orderHash: cancel.orderHash,
        },
        chainId: chainId.toString(),
        orderHash: cancelHash,
        signature,
    };

    console.log("signedCancelMessage:", signedMessage);
    console.log("CANCELS_URL:", CFG.CANCELS_URL);

    return httpPostJson<any>(CFG.CANCELS_URL, signedMessage);
}
