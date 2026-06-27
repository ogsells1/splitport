"use client";

import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { formatUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { USDC_ADDRESS, USDC_ABI } from "@/lib/contract";
import { ProjectAllocationRow } from "@/components/ProjectAllocationRow";

interface ProjectSummary {
  id: string;
  name: string;
  contractAddress: string;
}

export default function BalancePage() {
  const { ready, authenticated, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    if (ready && !authenticated) router.push("/");
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    fetch(`/api/projects?ownerPrivyId=${encodeURIComponent(user.id)}`)
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, [ready, authenticated, user]);

  const wallet = wallets[0];
  const walletAddress = wallet?.address as Address | undefined;

  const { data: balance, isLoading: balanceLoading } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress, refetchInterval: 8000 },
  });

  if (!ready || !authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const balanceFormatted = balance !== undefined ? parseFloat(formatUnits(balance, 6)).toFixed(2) : "—";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="font-semibold text-gray-900">BYN Split Pay</span>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              ← Dashboard
            </a>
            <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Unified Balance</h1>
          <p className="text-sm text-gray-500 mt-1">
            Your wallet's USDC balance, ready to be allocated to any of your projects.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Wallet Balance</p>
          <p className="text-3xl font-semibold text-gray-900">
            {balanceLoading ? "..." : balanceFormatted}
            <span className="text-base text-gray-400 ml-1.5">USDC</span>
          </p>
          {walletAddress && (
            <p className="text-xs text-gray-400 font-mono mt-2">{walletAddress}</p>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Allocate to a project
            </p>
          </div>

          {projects.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">
              No projects yet.{" "}
              <a href="/create" className="text-indigo-600 hover:underline">
                Create one
              </a>
              .
            </p>
          ) : (
            projects.map((p) => (
              <ProjectAllocationRow
                key={p.id}
                name={p.name}
                contractAddress={p.contractAddress as Address}
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
}
