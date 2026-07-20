"use client";

import { useState, type ReactNode } from "react";
import { SolanaProvider } from "@solana/react-hooks";
import { autoDiscover, createClient, type SolanaClient } from "@solana/client";
import { RPC_URL, WS_URL } from "@/lib/solana";

// autoDiscover() takes a SNAPSHOT of the Wallet-Standard wallets registered at
// that moment. The registry is actually event-driven (there is
// watchWalletStandardConnectors), but createClient accepts the list only once,
// and client.connectors is a Readonly with no updates — and connectWallet
// resolves the connector through exactly that list. So a wallet that registers
// late can only be surfaced by recreating the client, and that tears down the
// active session. We live with the snapshot: getWallets() synchronously emits
// app-ready, and extensions manage to register within the same tick. A user who
// still doesn't see their wallet is offered a page reload (WalletButton).
// The client is created lazily, not at module scope when the chunk loads.
let _client: SolanaClient | null = null;

export function getSolanaClient(): SolanaClient {
  return (_client ??= createClient({
    endpoint: RPC_URL,
    websocketEndpoint: WS_URL,
    walletConnectors: autoDiscover(),
  }));
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(getSolanaClient);
  return <SolanaProvider client={client}>{children}</SolanaProvider>;
}
