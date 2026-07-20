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
 * Кошелёк-дублёр для e2e: реализует ровно тот кусок Wallet Standard, который
 * читает @solana/client (`standard:connect` + `solana:signTransaction`).
 *
 * Приватный ключ в браузер НЕ попадает: страница отдаёт байты транзакции в Node
 * через exposeFunction, там они подписываются и возвращаются. Для приложения это
 * неотличимо от настоящего кошелька — код фронта исполняется тот же самый.
 */
export type StubWallet = { name: string; address: string; publicKey: number[] };

export async function loadSigner(keypairPath: string) {
  const bytes = new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8')));
  const keyPair = await createKeyPairFromBytes(bytes);
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  // Публичный ключ — последние 32 байта solana-keygen формата.
  return { keyPair, address, publicKey: Array.from(bytes.slice(32)) };
}

/** Регистрирует кошельки в странице и вешает подпись на Node-сторону. */
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

    // Wallet Standard: кошелёк объявляет себя в ответ на app-ready от приложения.
    const register = (api: { register: (w: unknown) => void }) => built.forEach((w) => api.register(w));
    window.addEventListener('wallet-standard:app-ready', (e) => register((e as CustomEvent).detail));
    window.dispatchEvent(
      new CustomEvent('wallet-standard:register-wallet', { detail: register }),
    );
  }, stubs);
}
