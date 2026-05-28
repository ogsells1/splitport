"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { VaultInfo } from "@/components/VaultInfo";
import { DepositModal } from "@/components/DepositModal";
import { DistributeButton } from "@/components/DistributeButton";

export default function Dashboard() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authenticated) {
      router.push("/");
    }
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const walletAddress =
    user?.wallet?.address ?? user?.linkedAccounts?.find(
      (a) => a.type === "wallet"
    )?.address;

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="font-semibold text-gray-900">BYN Split Pay</span>
          <div className="flex items-center gap-3">
            {shortAddress && (
              <span className="text-sm text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded-lg">
                {shortAddress}
              </span>
            )}
            <button
              onClick={logout}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <VaultInfo walletAddress={walletAddress} />

        <div className="grid grid-cols-2 gap-3">
          <DepositModal />
          <DistributeButton walletAddress={walletAddress} />
        </div>
      </main>
    </div>
  );
}
