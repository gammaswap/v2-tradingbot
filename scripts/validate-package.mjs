import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const packageName = packageManifest.name;
const validationDirectory = mkdtempSync(join(tmpdir(), "v2-tradingbot-package-"));
const npmCacheDirectory = join(validationDirectory, "npm-cache");
const pnpmStoreDirectory = join(validationDirectory, "pnpm-store");
const tsc = join(repositoryRoot, "node_modules", ".bin", "tsc");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: validationDirectory,
    stdio: "inherit",
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: npmCacheDirectory,
      npm_config_update_notifier: "false",
      pnpm_config_store_dir: pnpmStoreDirectory,
    },
    ...options,
  });
}

function listTarGzFiles(tarballPath) {
  const archive = gunzipSync(readFileSync(tarballPath));
  const files = [];
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    assert(Number.isSafeInteger(size) && size >= 0, `invalid tar entry size for ${name}`);

    files.push(prefix ? `${prefix}/${name}` : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return files;
}

try {
  run("pnpm", ["pack", "--pack-destination", validationDirectory], { cwd: repositoryRoot });

  const tarballs = readdirSync(validationDirectory).filter((file) => file.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, "expected exactly one packed trading-bot tarball");

  const tarballPath = join(validationDirectory, tarballs[0]);
  const packedFiles = listTarGzFiles(tarballPath);
  for (const requiredFile of [
    "package/package.json",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/README.md",
    "package/CHANGELOG.md",
    "package/LICENSE",
  ]) {
    assert(packedFiles.includes(requiredFile), `packed tarball is missing ${requiredFile}`);
  }
  for (const forbiddenPrefix of ["package/.env", "package/src/", "package/test/"]) {
    assert(
      !packedFiles.some((file) => file.startsWith(forbiddenPrefix)),
      `packed tarball includes ${forbiddenPrefix}`,
    );
  }

  writeFileSync(
    join(validationDirectory, "package.json"),
    JSON.stringify(
      {
        name: "v2-tradingbot-package-consumer",
        private: true,
        type: "module",
        dependencies: { [packageName]: `file:${tarballPath}` },
      },
      null,
      2,
    ),
  );

  run("pnpm", [
    "install",
    "--ignore-workspace",
    "--prod",
    "--no-frozen-lockfile",
    "--store-dir",
    pnpmStoreDirectory,
  ]);

  writeFileSync(
    join(validationDirectory, "import-smoke-test.mjs"),
    `import assert from "node:assert/strict";
import { TradingBot, validateTradingBotOptions } from ${JSON.stringify(packageName)};

assert.equal(typeof TradingBot, "function");
assert.equal(typeof validateTradingBotOptions, "function");
assert.deepEqual(
  validateTradingBotOptions({
    apiUrl: "https://example.com/api",
    assetId: "1",
    chainId: 1,
    contracts: {
      exchange: "0x1111111111111111111111111111111111111111",
      ledger: "0x2222222222222222222222222222222222222222",
      settlementToken: "0x3333333333333333333333333333333333333333",
    },
  }),
  [],
);
`,
  );
  run("node", [join(validationDirectory, "import-smoke-test.mjs")]);

  writeFileSync(
    join(validationDirectory, "consumer.ts"),
    `import { Wallet } from "ethers";
import { TradingBot, type TradingBotOptions } from ${JSON.stringify(packageName)};

const options: TradingBotOptions = {
  wallet: new Wallet("0x0123456789012345678901234567890123456789012345678901234567890123"),
  apiUrl: "https://example.com/api",
  assetId: "1",
  chainId: 1,
  contracts: {
    exchange: "0x1111111111111111111111111111111111111111",
    ledger: "0x2222222222222222222222222222222222222222",
    settlementToken: "0x3333333333333333333333333333333333333333",
  },
};

void new TradingBot(options);
`,
  );
  writeFileSync(
    join(validationDirectory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          noEmit: true,
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    ),
  );
  run(tsc, ["--project", join(validationDirectory, "tsconfig.json")]);

  console.log("Packed package imports and declarations validated successfully.");
} finally {
  rmSync(validationDirectory, { recursive: true, force: true });
}
