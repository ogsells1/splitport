"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useParams } from "next/navigation";
import { useEffect } from "react";
import { type Address, isAddress } from "viem";
import { VaultInfo } from "@/components/VaultInfo";
import { DepositModal } from "@/components/DepositModal";
import { DistributeButton } from "@/components/DistributeButton";
import { ContributorsEditor } from "@/components/ContributorsEditor";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";

export default function Dashboard() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const params = useParams<{ address: string }>();

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

  if (!isAddress(params.address)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600">
          Invalid project address.
        </div>
      </div>
    );
  }

  const vaultAddress = params.address as Address;

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
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <ProjectSwitcher ownerPrivyId={user?.id ?? ""} currentAddress={vaultAddress} />
          <div className="flex items-center gap-3">
            <a href="/treasury" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Treasury
            </a>
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
        <VaultInfo vaultAddress={vaultAddress} walletAddress={walletAddress} />

        <div className="grid grid-cols-2 gap-3">
          <DepositModal vaultAddress={vaultAddress} />
          <DistributeButton vaultAddress={vaultAddress} />
        </div>

        <ContributorsEditor
          vaultAddress={vaultAddress}
          walletAddress={walletAddress}
          ownerPrivyId={user?.id}
        />

        <a
          href={`/history?project=${vaultAddress}`}
          className="block w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors py-2 border border-gray-200 rounded-xl bg-white"
        >
          View Transaction History →
        </a>
      </main>
    </div>
  );
}
