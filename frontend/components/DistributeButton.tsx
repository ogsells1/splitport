"use client";

import { useState } from "react";
import { authedFetch } from "@/lib/apiClient";
import { useWriteContract, useReadContract, usePublicClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseUnits, type Address } from "viem";
import { VAULT_ABI } from "@/lib/contract";

interface DistributeButtonProps {
  vaultAddress: Address;
}

type Status = "idle" | "pending" | "done" | "error";

export function DistributeButton({ vaultAddress }: DistributeButtonProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"full" | "custom">("full");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  const { data: info } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "getProjectInfo",
    query: { refetchInterval: 8000 },
  });

  const pending = info?.pendingBalance ?? 0n;
  const hasBalance = pending > 0n;
  const pendingFormatted = parseFloat(formatUnits(pending, 6)).toFixed(2);

  const customAmountParsed = amount ? parseUnits(amount, 6) : 0n;
  const customValid =
    mode === "full" ||
    (customAmountParsed > 0n && customAmountParsed <= pending);

  async function handleDistribute() {
    if (!hasBalance || !customValid) return;

    setStatus("pending");
    setErrorMsg("");

    try {
      const txHash =
        mode === "full"
          ? await writeContractAsync({
              address: vaultAddress,
              abi: VAULT_ABI,
              functionName: "distribute",
            })
          : await writeContractAsync({
              address: vaultAddress,
              abi: VAULT_ABI,
              functionName: "distributePartial",
              args: [customAmountParsed],
            });

      await publicClient?.waitForTransactionReceipt({ hash: txHash });
      queryClient.invalidateQueries();

      authedFetch(`/api/transactions/sync?contractAddress=${vaultAddress}`, { method: "POST" }).catch(() => {});

      setStatus("done");
      setTimeout(() => {
        setOpen(false);
        setStatus("idle");
        setMode("full");
        setAmount("");
      }, 1500);
    } catch (e: any) {
      setErrorMsg(e?.shortMessage ?? e?.message ?? "Transaction failed");
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <div className="space-y-1.5">
        <button
          onClick={() => hasBalance && setOpen(true)}
          disabled={!hasBalance}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 font-medium rounded-xl transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          Distribute
        </button>

        {!hasBalance && (
          <p className="text-xs text-gray-400 text-center">No pending balance</p>
        )}
        {hasBalance && (
          <p className="text-xs text-indigo-500 text-center">{pendingFormatted} USDC pending</p>
        )}
      </div>
    );
  }

  const busy = status === "pending";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Distribute USDC</h3>
          <button
            onClick={() => { setOpen(false); setStatus("idle"); setMode("full"); setAmount(""); }}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-500">
          {pendingFormatted} USDC pending balance
        </p>

        <div className="flex gap-1 p-1 rounded-lg bg-gray-100">
          <button
            onClick={() => setMode("full")}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === "full" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
            }`}
          >
            Full amount
          </button>
          <button
            onClick={() => setMode("custom")}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === "custom" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
            }`}
          >
            Custom amount
          </button>
        </div>

        {mode === "custom" && (
          <div>
            <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-indigo-400 transition-colors">
              <input
                type="number"
                min="0"
                max={formatUnits(pending, 6)}
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 px-4 py-3 text-gray-900 text-lg outline-none"
              />
              <span className="px-3 text-gray-400 text-sm font-medium">USDC</span>
            </div>
            <button
              onClick={() => setAmount(formatUnits(pending, 6))}
              className="mt-1.5 text-xs text-indigo-500 hover:text-indigo-600"
            >
              Use max ({pendingFormatted})
            </button>
            {amount && customAmountParsed > pending && (
              <p className="text-xs text-red-500 mt-1">Amount exceeds pending balance.</p>
            )}
            <p className="text-xs text-gray-400 mt-2 bg-gray-50 rounded-lg px-3 py-2">
              The remaining balance stays in the vault for the next distribution.
            </p>
          </div>
        )}

        {status === "error" && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{errorMsg}</p>
        )}

        <button
          onClick={handleDistribute}
          disabled={!customValid || busy || status === "done"}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-xl transition-colors text-sm"
        >
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Distributing...
            </span>
          ) : status === "done" ? (
            "✓ Distributed!"
          ) : (
            "Distribute"
          )}
        </button>
      </div>
    </div>
  );
}
