import {
    type TypedDataDomain,
    keccak256,
    solidityPacked,
    AbiCoder,
    recoverAddress,
    Wallet,
    HDNodeWallet,
    Signature
} from "ethers";
import { CFG } from "../config/config.js";
import {
    Eip712Order,
    Eip712Deposit, Eip712Withdrawal, Eip712Cancel,
} from "./types.js";

export const EXCHANGE_DOMAIN: TypedDataDomain = {
    name: "GammaSwap Exchange",
    version: "2",
    chainId: CFG.CHAIN_ID,
    verifyingContract: CFG.VERIFYING_CONTRACT
};

const DEPOSIT_ORDER_TYPEHASH = keccak256(Buffer.from(
    "DepositOrder(uint256 nonce,uint256 salt,address signer,uint8 signatureType,address sender,uint32 expiration,uint256 amount,address token,address ledger,uint256 permitNonce,bytes permitSignature)"
    //"DepositOrder(uint256 nonce,uint256 salt,address signer,uint8 signatureType,address sender,uint32 expiration,uint256 amount,address token,address ledger,uint256 permitNonce,bytes32 permitSignature)"
));

const WITHDRAWAL_ORDER_TYPEHASH = keccak256(Buffer.from(
    "WithdrawalOrder(uint256 nonce,uint256 salt,address signer,uint8 signatureType,address sender,address receiver,uint256 amount,address ledger)"
));

const FILL_ORDER_TYPEHASH = keccak256(Buffer.from(
    "FillOrder(uint256 nonce,uint256 salt,address signer,uint8 signatureType,address sender,bool side,uint256 assetId,uint256 size,uint256 price)"
));

const CANCEL_ORDER_TYPEHASH = keccak256(Buffer.from(
    "CancelOrder(uint256 nonce,uint256 salt,address signer,uint8 signatureType,address sender,uint256 assetId,bytes32 orderHash)"
));

const abi = new AbiCoder();

function getDomainSeparator() {
    const EIP712_DOMAIN_TYPEHASH = keccak256(Buffer.from(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    ));

    return keccak256(abi.encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [
            EIP712_DOMAIN_TYPEHASH,
            keccak256(Buffer.from("GammaSwap Exchange")),
            keccak256(Buffer.from("2")),
            EXCHANGE_DOMAIN.chainId,
            EXCHANGE_DOMAIN.verifyingContract
        ]
    ));
}

function getDepositStructHash(order: Eip712Deposit) : string {
    return keccak256(abi.encode(
        [
            "bytes32",
            "uint256", // nonce
            "uint256", // salt
            "address", // signer
            "uint8",   // signatureType
            "address", // sender
            "uint32",  // expiration
            "uint256", // amount
            "address", // token
            "address", // ledger
            "uint256", // permitNonce
            "bytes"    // permitSignature
            //"bytes32"    // permitSignature
        ],
        [
            DEPOSIT_ORDER_TYPEHASH,
            order.nonce,
            order.salt,
            order.signer,
            order.signatureType,
            order.sender,
            order.expiration,
            order.amount,
            order.token,
            order.ledger,
            order.permitNonce,
            order.permitSignature,
            //keccak256(order.permitSignature),
        ]
    ));
}

function getWithdrawalStructHash(order: Eip712Withdrawal) : string {
    return keccak256(abi.encode(
        [
            "bytes32",
            "uint256", // nonce
            "uint256", // salt
            "address", // signer
            "uint8",   // signatureType
            "address", // sender
            "address", // receiver
            "uint256", // amount
            "address", // ledger
        ],
        [
            WITHDRAWAL_ORDER_TYPEHASH,
            order.nonce,
            order.salt,
            order.signer,
            order.signatureType,
            order.sender,
            order.receiver,
            order.amount,
            order.ledger,
        ]
    ));
}

function getFillStructHash(order: Eip712Order) : string {
    return keccak256(abi.encode(
        [
            "bytes32",
            "uint256", // nonce
            "uint256", // salt
            "address", // signer
            "uint8",   // signatureType
            "address", // sender
            "bool",    // side
            "uint256", // assetId
            "uint256", // size
            "uint256"  // price
        ],
        [
            FILL_ORDER_TYPEHASH,
            order.nonce,
            order.salt,
            order.signer,
            order.signatureType,
            order.sender,
            order.side,
            order.assetId,
            order.size,
            order.price,
        ]
    ));
}

function getCancelStructHash(order: Eip712Cancel) : string {
    return keccak256(abi.encode(
        [
            "bytes32",
            "uint256",
            "uint256",
            "address",
            "uint8",
            "address",
            "uint256",
            "bytes32"
        ],
        [
            CANCEL_ORDER_TYPEHASH,
            order.nonce,
            order.salt,
            order.signer,
            order.signatureType,
            order.sender,
            order.assetId,
            order.orderHash   // MUST be 32 bytes
        ]
    ));
}

export function hashDepositOrderJS(order: Eip712Deposit) : string {
    const structHash = getDepositStructHash(order);
    const domainSeparator = getDomainSeparator();

    // "\x19\x01" || domainSeparator || structHash
    return keccak256(
        solidityPacked(
            ["string", "bytes32", "bytes32"],
            ["\x19\x01", domainSeparator, structHash]
        )
    );
}

export function hashWithdrawalOrderJS(order: Eip712Withdrawal) : string {
    const structHash = getWithdrawalStructHash(order);
    const domainSeparator = getDomainSeparator();

    // "\x19\x01" || domainSeparator || structHash
    return keccak256(
        solidityPacked(
            ["string", "bytes32", "bytes32"],
            ["\x19\x01", domainSeparator, structHash]
        )
    );
}

export function hashFillOrderJS(order: Eip712Order) : string {
    const structHash = getFillStructHash(order);
    const domainSeparator = getDomainSeparator();

    // "\x19\x01" || domainSeparator || structHash
    return keccak256(
        solidityPacked(
            ["string", "bytes32", "bytes32"],
            ["\x19\x01", domainSeparator, structHash]
        )
    );
}

export function hashCancelOrderJS(order: Eip712Cancel) : string {
    const structHash = getCancelStructHash(order);
    const domainSeparator = getDomainSeparator();

    // "\x19\x01" || domainSeparator || structHash
    return keccak256(
        solidityPacked(
            ["string", "bytes32", "bytes32"],
            ["\x19\x01", domainSeparator, structHash]
        )
    );
}

export function signOrderJS(orderHash: string, wallet: Wallet) : string {
    const sigObj = wallet.signingKey.sign(orderHash);
    // sigObj: { r: string, s: string, v: number }

    // Pack r || s || v exactly like abi.encodePacked(r, s, v)
    return Signature.from(sigObj).serialized;
}

export function validateSignatureJS(digest: string, signature: string, expectedSigner: string): boolean {
    // recover signer from raw digest + 65-byte signature
    const recovered = recoverAddress(digest, signature);
    return recovered.toLowerCase() === expectedSigner.toLowerCase();
}

// Derive a few accounts: index 0,1,2 on path m/44'/60'/0'/0/i
export function deriveAccountsFromMnemonic(
    mnemonic: string,
    count: number
): { index: number; address: string; privateKey: string }[] {
    const accounts: { index: number; address: string; privateKey: string }[] = [];

    for (let i = 0; i < count; i++) {
        // For ethers v6, Wallet.fromPhrase supports an optional derivation path argument
        const path = `m/44'/60'/0'/0/${i}`;
        const wallet = HDNodeWallet.fromPhrase(mnemonic,"", path);
        accounts.push({
            index: i,
            address: wallet.address,
            privateKey: wallet.privateKey,
        });
    }

    return accounts;
}
