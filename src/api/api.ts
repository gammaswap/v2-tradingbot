import { isAddress, type Wallet, ZeroAddress, ZeroHash } from "ethers";
import {
    createExchangeClient,
    createInfoClient,
    OrderSide,
    TimeInForce,
    type ExchangeClient,
    type ExchangeContractsInput,
    type FetchLike,
    type HttpResult,
} from "@gammaswap/v2-exchange-sdk";
import { RUNTIME_CFG as CFG, type Side } from "../runtime/context.js";
import type {
    ApiBalancesResponse,
    ApiAssetResponse,
    ApiBookResponse,
    ApiPendingResponse,
    ApiPositionResponse,
    ApiResolutionPriceResponse,
    BookLevel,
    PendingOrder,
} from "../utils/types.js";
import { assertProtocolOrder, assertProtocolPrice } from "../utils/protocolPrice.js";

const PRICE_TENTH_CENT_SCALE = 1_000n;
const SIZE_HUNDREDTH_SCALE = 10_000n;

const sdkFetch: FetchLike = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    if (CFG.API_KEY) headers.set("X-API-KEY", CFG.API_KEY);

    if (CFG.API_SECRET && init.body != null) {
        const body = typeof init.body === "string" ? init.body : init.body.toString();
        const { createHmac } = await import("node:crypto");
        headers.set("X-SIGNATURE", createHmac("sha256", CFG.API_SECRET).update(body).digest("hex"));
    }

    return fetch(url, { ...init, headers });
};

export function getInfoClientOptions() {
    return {
        apiUrl: CFG.API_URL,
        fetch: sdkFetch,
        timeoutMs: CFG.API_TIMEOUT_MS,
    };
}

const infoClients = new Map<string, ReturnType<typeof createInfoClient>>();

function getInfoClient() {
    const key = `${CFG.API_URL}:${CFG.API_TIMEOUT_MS}:${CFG.API_KEY}:${CFG.API_SECRET}`;
    const cached = infoClients.get(key);
    if (cached) return cached;
    const client = createInfoClient(getInfoClientOptions());
    infoClients.set(key, client);
    return client;
}

const exchangeClients = new Map<string, ExchangeClient>();

function getExchangeClient(wallet: Wallet): ExchangeClient {
    const key = [
        wallet.address.toLowerCase(),
        CFG.API_URL,
        CFG.CHAIN_ID,
        CFG.EXCHANGE_ADDRESS,
        CFG.LEDGER_ADDRESS,
        CFG.SETTLEMENT_TOKEN,
        CFG.PERMIT2_ADDRESS,
    ].join(":");
    const cached = exchangeClients.get(key);
    if (cached) return cached;

    const client = createExchangeClient({
        apiUrl: CFG.API_URL,
        wallet,
        chainId: CFG.CHAIN_ID.toString(),
        fetch: sdkFetch,
        contracts: getConfiguredContracts(),
        infoClient: getInfoClient(),
    });

    exchangeClients.set(key, client);
    return client;
}

function getConfiguredContracts(): ExchangeContractsInput | undefined {
    if (!isNonZeroAddress(CFG.EXCHANGE_ADDRESS) || !isNonZeroAddress(CFG.LEDGER_ADDRESS)) {
        return undefined;
    }

    const contracts: ExchangeContractsInput = {
        exchange: CFG.EXCHANGE_ADDRESS,
        ledger: CFG.LEDGER_ADDRESS,
    };

    if (isNonZeroAddress(CFG.DEPOSIT_LEDGER_ADDRESS)) contracts.depositLedger = CFG.DEPOSIT_LEDGER_ADDRESS;
    if (isNonZeroAddress(CFG.SETTLEMENT_TOKEN)) contracts.settlementToken = CFG.SETTLEMENT_TOKEN;
    if (isNonZeroAddress(CFG.PERMIT2_ADDRESS)) contracts.permit2 = CFG.PERMIT2_ADDRESS;

    return contracts;
}

function isNonZeroAddress(value: string): boolean {
    return isAddress(value) && value.toLowerCase() !== ZeroAddress.toLowerCase();
}

export function protocolPriceToSdkInput(price: number | bigint): string {
    assertProtocolPrice(price);
    const value = toProtocolBigInt(price, "price");
    if (value % PRICE_TENTH_CENT_SCALE !== 0n) {
        throw new Error(`price ${value.toString()} cannot be represented as SDK price input`);
    }

    const tenthsOfCents = value / PRICE_TENTH_CENT_SCALE;
    return `${tenthsOfCents / 10n}.${tenthsOfCents % 10n}`;
}

export function protocolAmountToSdkInput(amount: number | bigint): string {
    const value = toProtocolBigInt(amount, "amount");
    if (value % SIZE_HUNDREDTH_SCALE !== 0n) {
        throw new Error(`amount ${value.toString()} cannot be represented as SDK amount input`);
    }

    const hundredths = value / SIZE_HUNDREDTH_SCALE;
    const whole = hundredths / 100n;
    const fraction = hundredths % 100n;
    if (fraction === 0n) return whole.toString();
    if (fraction % 10n === 0n) return `${whole.toString()}.${(fraction / 10n).toString()}`;
    return `${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

function toProtocolBigInt(value: number | bigint, label: string): bigint {
    if (typeof value === "bigint") return value;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer in protocol units`);
    }
    return BigInt(value);
}

function parseBigIntField(value: unknown, label: string): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return BigInt(value);
    throw new Error(`Invalid bigint field ${label}: ${String(value)}`);
}

function parseNumberField(value: unknown, label: string): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    throw new Error(`Invalid number field ${label}: ${String(value)}`);
}

function normalizeBookLevel(input: any, side: Side, epoch: number): BookLevel {
    const price = parseNumberField(input.price, "level.price");
    return {
        price,
        size: parseNumberField(input.size, "level.size"),
        orderCount: Number(input.orderCount ?? input.orders?.length ?? 0),
        orders: normalizePendingOrders(input.orders ?? [], side, epoch, price),
    };
}

function normalizePendingOrders(orders: any[], side: Side, epoch: number, fallbackPrice?: number): PendingOrder[] {
    return orders.map((order) => ({
        id: String(order.id),
        price: parseNumberField(order.price ?? fallbackPrice, "order.price"),
        size: parseNumberField(order.size, "order.size"),
        side: side,
        time: parseNumberField(order.time, "order.time"),
        account: String(order.account ?? ""),
        epoch: BigInt(epoch)
    }));
}

function normalizeBook(data: any): ApiBookResponse {
    const epoch = parseNumberField(data.epoch, "book.epoch");
    return {
        assetId: parseBigIntField(data.assetId ?? CFG.ASSET_ID, "book.assetId"),
        epoch: parseBigIntField(data.epoch, "book.epoch"),
        seqId: parseBigIntField(data.seqId, "book.seqId"),
        ts: parseBigIntField(data.ts ?? Date.now(), "book.ts"),
        bids: (data.bids || []).map((level: BookLevel) => normalizeBookLevel(level, "buy", epoch)),
        asks: (data.asks || []).map((level: BookLevel) => normalizeBookLevel(level, "sell", epoch)),
    };
}

function normalizePending(data: any, address: string, epoch: number): ApiPendingResponse {
    return {
        assetId: parseBigIntField(data.assetId ?? CFG.ASSET_ID, "pending.assetId"),
        ts: parseBigIntField(data.ts ?? Date.now(), "pending.ts"),
        epoch: parseBigIntField(data.epoch ?? epoch, "pending.epoch"),
        buys: normalizePendingOrders(data.buys ?? [], "buy", epoch).map((order) => ({ ...order, account: order.account || address })),
        sells: normalizePendingOrders(data.sells ?? [], "sell", epoch).map((order) => ({ ...order, account: order.account || address })),
    };
}

function normalizeBalance(data: any): ApiBalancesResponse {
    return {
        account: String(data.account ?? CFG.USER_ADDRESS),
        ts: parseNumberField(data.ts ?? Date.now(), "balance.ts"),
        balance: parseBigIntField(data.balance, "balance.balance"),
        pending: parseBigIntField(data.pending, "balance.pending"),
    };
}

function normalizePosition(data: any, epoch: number): ApiPositionResponse {
    return {
        account: String(data.account ?? CFG.USER_ADDRESS),
        assetId: parseBigIntField(data.assetId ?? CFG.ASSET_ID, "position.assetId"),
        epoch: parseBigIntField(data.epoch ?? epoch, "position.epoch"),
        ts: parseNumberField(data.ts ?? Date.now(), "position.ts"),
        size: parseBigIntField(data.size, "position.size"),
        margin: parseBigIntField(data.margin, "position.margin"),
        balance: parseBigIntField(data.balance, "position.balance"),
        pnl: parseBigIntField(data.pnl, "position.pnl"),
        side: Boolean(data.side),
        bSide: Boolean(data.bSide),
        mSide: Boolean(data.mSide),
        pSide: Boolean(data.pSide),
    };
}

function normalizeResolutionPrice(data: any): ApiResolutionPriceResponse {
    return {
        assetId: parseBigIntField(data.assetId ?? CFG.ASSET_ID, "resolution.assetId"),
        epoch: parseBigIntField(data.epoch, "resolution.epoch"),
        price: parseBigIntField(data.price, "resolution.price"),
        id: parseNumberField(data.id, "resolution.id"),
        ts: parseBigIntField(data.ts, "resolution.ts"),
        isNull: Boolean(data.isNull),
    };
}

export function normalizeAsset(data: any): ApiAssetResponse {
    return {
        assetId: parseBigIntField(data.assetId, "asset.assetId"),
        epoch: parseBigIntField(data.epoch, "asset.epoch"),
        registered: Boolean(data.registered),
        expiration: parseBigIntField(data.expiration, "asset.expiration"),
        assetType: parseBigIntField(data.assetType, "asset.assetType"),
        strikePrice: parseBigIntField(data.strikePrice, "asset.strikePrice"),
        resolutionPrice: parseBigIntField(data.resolutionPrice, "asset.resolutionPrice"),
        isResolved: Boolean(data.isResolved),
        ledger: String(data.ledger),
    };
}

function unwrapData<T>(result: HttpResult<T>): T {
    return result.data;
}

export async function apiGetBook(epoch: bigint | number): Promise<ApiBookResponse> {
    const data = unwrapData(await getInfoClient().getOrderBook({ assetId: CFG.ASSET_ID, epoch: epoch.toString() }));
    return normalizeBook(data);
}

export async function apiGetAsset(): Promise<ApiAssetResponse> {
    const data = unwrapData(await getInfoClient().getAsset(CFG.ASSET_ID));
    return normalizeAsset(data);
}

export async function apiGetAssetAtEpoch(epoch: bigint | number): Promise<ApiAssetResponse> {
    const data = unwrapData(await getInfoClient().getAssetAtEpoch({
        assetId: CFG.ASSET_ID,
        epoch: epoch.toString(),
    }));
    return normalizeAsset(data);
}

export async function apiGetBalance(): Promise<ApiBalancesResponse> {
    const data = unwrapData(await getInfoClient().getBalance(CFG.USER_ADDRESS));
    return normalizeBalance(data);
}

export async function apiGetPosition(epoch: bigint | number): Promise<ApiPositionResponse> {
    const data = unwrapData(await getInfoClient().getPosition({
        account: CFG.USER_ADDRESS,
        assetId: CFG.ASSET_ID,
        epoch: epoch.toString(),
    }));
    return normalizePosition(data, Number(epoch));
}

export async function apiGetPending(address: string, epoch: bigint | number): Promise<ApiPendingResponse> {
    const data = unwrapData(await getInfoClient().getBookOrders({
        assetId: CFG.ASSET_ID,
        epoch: epoch.toString(),
        account: address,
    }));
    return normalizePending(data, address, Number(epoch));
}

export async function apiLastResolutionPrice(): Promise<ApiResolutionPriceResponse> {
    const data = unwrapData(await getInfoClient().getLastResolutionPrice(CFG.ASSET_ID));
    return normalizeResolutionPrice(data);
}

export async function apiSendOrder(wallet: Wallet, order: { epoch: bigint | number, side: Side; price: number; size: number; tif?: 0n | 1n | 2n | 3n; nonce?: bigint }) {
    assertProtocolOrder(order.side, order.size, order.price);
    const client = getExchangeClient(wallet);
    const res = await client.placeOrder({
        assetId: CFG.ASSET_ID,
        epoch: order.epoch.toString(),
        side: order.side === "buy" ? OrderSide.BUY : OrderSide.SELL,
        price: protocolPriceToSdkInput(order.price),
        size: protocolAmountToSdkInput(order.size),
        timeInForce: order.tif ?? TimeInForce.GTC,
        ...(order.nonce == null ? {} : { nonce: order.nonce }),
    });

    console.log("signedOrderMessage:", res.request);
    return res;
}

export async function apiCancelOrder(wallet: Wallet, epoch: bigint | number, orderHash: string, nonce?: bigint) {
    const client = getExchangeClient(wallet);
    const input = {
        assetId: CFG.ASSET_ID,
        epoch: epoch.toString(),
    };

    const nonceInput = nonce == null ? {} : { nonce };
    const res = orderHash.toLowerCase() === ZeroHash.toLowerCase()
        ? await client.cancelAll({ ...input, ...nonceInput })
        : await client.cancelOrder({ ...input, orderHash, ...nonceInput });

    console.log("signedCancelMessage:", res.request);
    return res;
}

export async function apiClaim(wallet: Wallet, epoch: bigint | number) {
    const client = getExchangeClient(wallet);
    const res = await client.claim({
        assetId: CFG.ASSET_ID,
        epoch: epoch.toString(),
    });

    console.log("signedClaimMessage:", res.request);
    return res;
}

export async function apiCancelReplaceOrder(
    wallet: Wallet,
    input: {
        epoch: bigint | number;
        orderHash: string;
        side: Side;
        price: number;
        size: number;
        allOrNothing?: boolean;
        timeInForce?: 0n | 1n | 2n | 3n;
        nonce: bigint;
        replacementNonce: bigint;
    },
) {
    assertProtocolOrder(input.side, input.size, input.price);
    const client = getExchangeClient(wallet);
    const res = await client.cancelReplaceOrder({
        assetId: CFG.ASSET_ID,
        epoch: input.epoch.toString(),
        cancelOrderHash: input.orderHash,
        side: input.side === "buy" ? OrderSide.BUY : OrderSide.SELL,
        price: protocolPriceToSdkInput(input.price),
        size: protocolAmountToSdkInput(input.size),
        // The installed SDK exposes GTC/FOK/IOC constants but the API also
        // supports ALO as value 3.
        timeInForce: input.timeInForce ?? 3n,
        allOrNothing: input.allOrNothing ?? false,
        nonce: input.nonce,
        replacementNonce: input.replacementNonce,
    });

    console.log("signedCancelReplaceMessage:", res.request);
    return res;
}
