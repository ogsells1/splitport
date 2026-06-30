"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";

interface ProjectSummary {
  id: string;
  name: string;
  contractAddress: string;
  contributorCount: number;
}

export default function DashboardHub() {
  const { ready, authenticated, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  const walletAddress = wallets[0]?.address as Address | undefined;

  useEffect(() => {
    if (ready && !authenticated) router.push("/");
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    fetch(`/api/projects?ownerPrivyId=${encodeURIComponent(user.id)}`)
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ready, authenticated, user]);

  useEffect(() => {
    if (!walletAddress) return;
    fetch(`/api/cabinet?wallet=${walletAddress}`)
      .then((r) => r.json())
      .then((d) => setClaimable(BigInt(d.claimable ?? "0")))
      .catch(() => {});
  }, [walletAddress]);

  if (!ready || !authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const claimableFormatted = parseFloat(formatUnits(claimable, 6)).toFixed(2);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <a href="/dashboard" className="font-semibold text-gray-900 hover:text-indigo-600 transition-colors">BYN Split Pay</a>
          <div className="flex items-center gap-3">
            <a href="/treasury" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Treasury
            </a>
            <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-xl font-semibold text-gray-900">Home</h1>

        {/* As a contributor */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Your cabinet</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Money you've earned as a contributor.
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-gray-900">
                {claimableFormatted}
                <span className="text-xs text-gray-400 ml-1">USDC</span>
              </p>
              <p className="text-xs text-gray-400">to claim</p>
            </div>
          </div>
          <button
            onClick={() => router.push("/cabinet")}
            className="mt-4 w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Open cabinet
          </button>
        </div>

        {/* As a creator */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Your projects</p>
              <p className="text-sm text-gray-500 mt-0.5">Projects you create and manage.</p>
            </div>
            <button
              onClick={() => router.push("/create")}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium whitespace-nowrap"
            >
              + New
            </button>
          </div>

          {loading ? (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">Loading...</p>
          ) : projects.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">
              No projects yet.{" "}
              <a href="/create" className="text-indigo-600 hover:underline">
                Create your first
              </a>
              .
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => router.push(`/dashboard/${p.contractAddress}`)}
                  className="w-full text-left px-5 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between"
                >
                  <span className="text-sm font-medium text-gray-900">{p.name}</span>
                  <span className="text-xs text-gray-400">{p.contributorCount} contributors</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
