"use client";

import { useState, type ReactNode } from "react";
import { SolanaProvider } from "@solana/react-hooks";
import { autoDiscover, createClient, type SolanaClient } from "@solana/client";
import { RPC_URL, WS_URL } from "@/lib/solana";

// autoDiscover() снимает срез уже зарегистрированных Wallet-Standard кошельков,
// а реестр статичный — поэтому создаём клиент лениво, на первом клиентском
// рендере, а не на module-scope при загрузке чанка.
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
