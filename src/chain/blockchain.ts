import { ethers } from "ethers";
import { CFG } from "../config/config.js";
import { Asset, Position } from "../utils/types.js";

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

// Minimal ACCOUNT_LEDGER ABI
const ACCOUNT_LEDGER_ABI = [
    "function balanceOf(address owner) external view returns (uint256)"
];

// Minimal MARGIN_EXCHANGE ABI
const MARGIN_EXCHANGE_ABI = [
    "function getPosition(uint256 assetId, uint256 epoch, address account) external view returns (uint256 txId, uint256 size, uint256 balance, uint256 margin, uint256 pnl, bool side, bool bSide, bool mSide, bool pSide, bool claimed)",
    "function getOrderStatus(bytes32 orderHash) external view returns (address sender, bool isFilledOrCancelled, uint8 orderType, uint256 remaining)",
    "function getAsset(uint256 assetId) external view returns (uint256 strikePrice,address oracle,address ledger,uint32 expiration,uint8 assetType,bool registered,uint256 epoch)"
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