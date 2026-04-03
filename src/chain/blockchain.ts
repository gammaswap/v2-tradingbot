import { ethers } from "ethers";
import { CFG } from "../config/config.js";
import { Asset, Position } from "../utils/types.js";
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { abi: MARGIN_EXCHANGE_ABI } = require("@gammaswap/v2-exchange/out/MarginExchange.sol/MarginExchange.json");
const { abi: ACCOUNT_LEDGER_ABI } = require("@gammaswap/v2-exchange/out/AccountLedger.sol/AccountLedger.json");

let provider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
    if (!provider) {
        const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
        provider = new ethers.JsonRpcProvider(RPC_URL);
    }
    return provider;
}

// Minimal ERC20 ABI
const ERC20_ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

// Minimal PERMIT2 ABI
const PERMIT2_ABI = [
    "function nonceBitmap(address owner, uint256 wordPos) external view returns (uint256)"
];

/**
 * Returns a wallet's permit2 allowance in raw uint256 (BigInt)
 */
export async function getPermit2Allowance(
    user: string,
    tokenAddress: string
): Promise<bigint> {
    const provider = getProvider();
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    return await token.allowance(user, CFG.PERMIT2_ADDRESS);
}

export async function isPermit2NonceUsed(owner: string, nonce: bigint) : Promise<boolean> {
    const n = BigInt(nonce);
    const wordPos = n >> 8n;
    const bitPos = n & 0xffn;

    const provider = getProvider();
    const permit2 = new ethers.Contract(CFG.PERMIT2_ADDRESS, PERMIT2_ABI, provider);
    const bitmap: bigint = await permit2.nonceBitmap(owner, wordPos);
    return (bitmap & (1n << bitPos)) !== 0n;
}

/**
 * Returns a wallet's ledger balance in raw uint256 (BigInt)
 */
export async function getLedgerBalance(
    user: string
): Promise<bigint> {
    const provider = getProvider();
    const ledger = new ethers.Contract(CFG.LEDGER_ADDRESS, ACCOUNT_LEDGER_ABI, provider);
    return await ledger.balanceOf(user);
}

export async function getAssetById(
    assetId: bigint
): Promise<Asset> {
    const provider = getProvider();
    const exchange = new ethers.Contract(CFG.EXCHANGE_ADDRESS, MARGIN_EXCHANGE_ABI, provider);
    return await exchange.getAsset(assetId);
}

export async function isAssetRegistered(
    assetId: bigint
): Promise<boolean> {
    const asset = await getAssetById(assetId) as Asset;
    return asset.strikePrice > 0n && asset.assetType > 0n && asset.expiration > 0n && asset.registered;
}

/**
 * Returns a wallet's ledger balance in raw uint256 (BigInt)
 */
export async function getPositionBalance(
    assetId: bigint,
    user: string
): Promise<Position> {
    const provider = getProvider();
    const exchange = new ethers.Contract(CFG.EXCHANGE_ADDRESS, MARGIN_EXCHANGE_ABI, provider);
    const resp = await exchange.getPosition(assetId, 0, user); // Must change to correct epoch in future versions
    return {
        txId: resp.txId,
        size: resp.size,
        balance: resp.balance,
        margin: resp.margin,
        pnl: resp.pnl,
        side: resp.side,
        bSide: resp.bSide,
        mSide: resp.mSide,
        pSide: resp.pSide,
        claimed: resp.claimed,
    } as Position;
}