"use client";

import { useState, type ReactNode } from "react";
import { SolanaProvider } from "@solana/react-hooks";
import { autoDiscover, createClient, type SolanaClient } from "@solana/client";
import { RPC_URL, WS_URL } from "@/lib/solana";

// autoDiscover() снимает СРЕЗ зарегистрированных на этот момент Wallet-Standard
// кошельков. Реестр на самом деле событийный (есть watchWalletStandardConnectors),
// но createClient принимает список один раз, а client.connectors — Readonly без
// апдейта, и connectWallet резолвит коннектор именно через него. Значит показать
// поздно зарегистрировавшийся кошелёк можно только вместе с пересозданием клиента,
// а это рвёт активную сессию. Живём со срезом: getWallets() синхронно шлёт
// app-ready, и расширения успевают зарегистрироваться в том же тике. Пользователю,
// который всё же не увидел свой кошелёк, предлагаем перезагрузку (WalletButton).
// Клиент создаём лениво, а не на module-scope при загрузке чанка.
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
