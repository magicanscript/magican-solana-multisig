import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  createKeyPairFromBytes,
  getBase64Encoder,
  getBase64Decoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  getAddressFromPublicKey,
} from '@solana/kit';

/**
 * A stand-in wallet for e2e: it implements exactly the slice of Wallet Standard that
 * @solana/client reads (`standard:connect` + `solana:signTransaction`).
 *
 * The private key never reaches the browser: the page hands the transaction bytes to Node
 * via exposeFunction, they are signed there and returned. For the application this is
 * indistinguishable from a real wallet — the very same frontend code runs.
 */
export type StubWallet = { name: string; address: string; publicKey: number[] };

export async function loadSigner(keypairPath: string) {
  const bytes = new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8')));
  const keyPair = await createKeyPairFromBytes(bytes);
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  // The public key is the last 32 bytes of the solana-keygen format.
  return { keyPair, address, publicKey: Array.from(bytes.slice(32)) };
}

/** Registers the wallets in the page and hooks signing up to the Node side. */
export async function installWallets(
  page: Page,
  signers: { name: string; keyPair: CryptoKeyPair; address: string; publicKey: number[] }[],
) {
  const txDecoder = getTransactionDecoder();
  const txEncoder = getTransactionEncoder();

  await page.exposeFunction('__stubSign', async (name: string, b64: string) => {
    const signer = signers.find((s) => s.name === name);
    if (!signer) throw new Error(`no stub wallet ${name}`);
    const bytes = new Uint8Array(getBase64Encoder().encode(b64));
    const tx = txDecoder.decode(bytes);
    const signed = await partiallySignTransaction([signer.keyPair], tx);
    return getBase64Decoder().decode(new Uint8Array(txEncoder.encode(signed)));
  });

  const stubs: StubWallet[] = signers.map((s) => ({
    name: s.name,
    address: s.address,
    publicKey: s.publicKey,
  }));

  await page.addInitScript((wallets: StubWallet[]) => {
    const b64encode = (bytes: Uint8Array) => {
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    };
    const b64decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

    const built = wallets.map((w) => {
      const account = {
        address: w.address,
        publicKey: new Uint8Array(w.publicKey),
        chains: ['solana:devnet'],
        features: ['solana:signTransaction'],
        label: w.name,
      };
      return {
        version: '1.0.0',
        name: w.name,
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
        chains: ['solana:devnet'],
        accounts: [account],
        features: {
          'standard:connect': {
            version: '1.0.0',
            connect: async () => ({ accounts: [account] }),
          },
          'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
          'standard:events': { version: '1.0.0', on: () => () => {} },
          'solana:signTransaction': {
            version: '1.0.0',
            supportedTransactionVersions: ['legacy', 0],
            signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
              const out = [];
              for (const input of inputs) {
                const signedB64 = await (
                  window as unknown as {
                    __stubSign: (n: string, b: string) => Promise<string>;
                  }
                ).__stubSign(w.name, b64encode(new Uint8Array(input.transaction)));
                out.push({ signedTransaction: b64decode(signedB64) });
              }
              return out;
            },
          },
        },
      };
    });

    // Wallet Standard: the wallet announces itself in response to app-ready from the app.
    const register = (api: { register: (w: unknown) => void }) => built.forEach((w) => api.register(w));
    window.addEventListener('wallet-standard:app-ready', (e) => register((e as CustomEvent).detail));
    window.dispatchEvent(
      new CustomEvent('wallet-standard:register-wallet', { detail: register }),
    );
  }, stubs);
}
