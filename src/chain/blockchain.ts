import { ethers } from "ethers";
import { Asset, OrderStatus } from "../utils/types.js";

let provider: ethers.JsonRpcProvider | null = null;

const PERMIT2_ADDRESS = process.env.PERMIT2_CONTRACT ||"0x000000000022D473030F116dDEE9F6B43aC78BA3"
const LEDGER_CONTRACT = process.env.LEDGER_CONTRACT ||"0x0000000000000000000000000000000000000000"
const EXCHANGE_CONTRACT = process.env.EXCHANGE_CONTRACT ||"0x0000000000000000000000000000000000000000"

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
    "function getOrderStatus(bytes32 orderHash) external view returns (address sender, bool isFilledOrCancelled, uint8 orderType, uint256 remaining)",
    "function assetById(uint256 assetId) external view returns (uint256 strikePrice,address oracle,uint32 expiration,uint8 assetType,bool registered)"
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
    return await token.allowance(user, PERMIT2_ADDRESS);
}

export async function isPermit2NonceUsed(owner: string, nonce: bigint) : Promise<boolean> {
    const n = BigInt(nonce);
    const wordPos = n >> 8n;
    const bitPos = n & 0xffn;

    const provider = getProvider();
    const permit2 = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);
    const bitmap: bigint = await permit2.nonceBitmap(owner, wordPos);
    return (bitmap & (1n << bitPos)) !== 0n;
}
