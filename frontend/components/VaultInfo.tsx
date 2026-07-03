"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits, type Address } from "viem";
import { VAULT_ABI } from "@/lib/contract";

interface VaultInfoProps {
  vaultAddress: Address;
  walletAddress?: string;
}

const ROLE_COLORS: Record<string, { bg: string; text: string; short: string }> = {
  label:    { bg: "bg-emerald-50",   text: "text-emerald-800",   short: "LB" },
  artist:   { bg: "bg-green-50",  text: "text-green-800",  short: "AR" },
  producer: { bg: "bg-amber-50",  text: "text-amber-800",  short: "PR" },
  default:  { bg: "bg-stone-100",  text: "text-stone-700",   short: "??" },
};

function roleStyle(role: string) {
  return ROLE_COLORS[role.toLowerCase()] ?? ROLE_COLORS.default;
}

function fmt(val: bigint | undefined, decimals = 6) {
  if (val === undefined) return "–";
  return parseFloat(formatUnits(val, decimals)).toFixed(2);
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function VaultInfo({ vaultAddress, walletAddress }: VaultInfoProps) {
  const { data: info, isLoading: infoLoading } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "getProjectInfo",
    query: { refetchInterval: 8000 },
  });

  const { data: contributors, isLoading: contribLoading } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "getContributors",
    query: { refetchInterval: 8000 },
  });

  const { data: owner } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "owner",
  });

  const isOwner =
    walletAddress && owner
      ? walletAddress.toLowerCase() === owner.toLowerCase()
      : false;

  const isLoading = infoLoading || contribLoading;

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 bg-stone-100 rounded-2xl" />
        <div className="h-48 bg-stone-100 rounded-2xl" />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600">
        Failed to load vault data. Check RPC connection.
      </div>
    );
  }

  const pending = info.pendingBalance;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Project</p>
          <h2 className="text-xl font-semibold text-stone-900">{info.name}</h2>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          <span className="text-xs text-stone-400">Arc Testnet</span>
          {isOwner && (
            <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
              owner
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Balance", value: fmt(pending), highlight: pending > 0n },
          { label: "Deposited", value: fmt(info.totalDeposited) },
          { label: "Distributed", value: fmt(info.totalDistributed) },
          { label: "Contributors", value: String(info.contributorCount) },
        ].map(({ label, value, highlight }) => (
          <div
            key={label}
            className={`rounded-xl p-3 ${highlight ? "bg-emerald-50 border border-emerald-100" : "bg-white border border-stone-200"}`}
          >
            <p className="text-xs text-stone-400 mb-1">{label}</p>
            <p className={`text-lg font-semibold ${highlight ? "text-emerald-800" : "text-stone-900"}`}>
              {value}
            </p>
            {label !== "Contributors" && (
              <p className="text-xs text-stone-400 mt-0.5">USDC</p>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100">
          <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">
            Contributors
          </p>
        </div>

        {contributors && contributors.length > 0 ? (
          <div className="divide-y divide-stone-100">
            {contributors.map((c) => {
              const style = roleStyle(c.role);
              const isDead =
                c.wallet.toLowerCase() ===
                "0x000000000000000000000000000000000000dead";
              const pct = Number(c.percentage) / 100;
              const share = (Number(pending) / 1e6) * (Number(c.percentage) / 10000);

              return (
                <div
                  key={c.wallet}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${style.bg} ${style.text}`}
                  >
                    {style.short}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 font-mono">
                      {shortAddr(c.wallet)}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                        {c.role}
                      </span>
                      {isDead && (
                        <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          ⚠ placeholder
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-semibold text-stone-900">
                      {pct.toFixed(0)}%
                    </p>
                    {pending > 0n && (
                      <p className="text-xs text-emerald-600 mt-0.5">
                        → {share.toFixed(2)} USDC
                      </p>
                    )}
                    <p className="text-xs text-stone-400 mt-0.5">
                      paid: {fmt(c.totalPaid)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-4 py-6 text-sm text-stone-400 text-center">
            No contributors found
          </p>
        )}
      </div>

      <a
        href={`https://testnet.arcscan.app/address/${vaultAddress}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-xs text-stone-400 hover:text-stone-600 transition-colors font-mono bg-white border border-stone-200 rounded-xl px-3 py-2"
      >
        <span>{vaultAddress}</span>
        <svg className="w-3 h-3 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
}
