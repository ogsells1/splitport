"use client";

import { useState } from "react";
import { useWriteContract, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { VAULT_ADDRESS, VAULT_ABI } from "@/lib/contract";

interface DistributeButtonProps {
  walletAddress?: string;
}

export function DistributeButton({ walletAddress }: DistributeButtonProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const { writeContractAsync } = useWriteContract();

  const { data: info } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "getProjectInfo",
  });

  const { data: owner } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "owner",
  });

  const pending = info?.pendingBalance ?? 0n;
  const isOwner =
    walletAddress && owner
      ? walletAddress.toLowerCase() === owner.toLowerCase()
      : false;
  const hasBalance = pending > 0n;

  async function handleDistribute() {
    if (!hasBalance) return;

    setStatus("pending");
    setErrorMsg("");

    try {
      await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "distribute",
      });

      setStatus("done");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (e: any) {
      setErrorMsg(e?.shortMessage ?? e?.message ?? "Transaction failed");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  }

  const pendingFormatted = parseFloat(formatUnits(pending, 6)).toFixed(2);

  return (
    <div className="space-y-1.5">
      <button
        onClick={handleDistribute}
        disabled={!hasBalance || status === "pending" || status === "done"}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 font-medium rounded-xl transition-colors text-sm"
      >
        {status === "pending" ? (
          <>
            <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            Distributing...
          </>
        ) : status === "done" ? (
          "✓ Distributed!"
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Distribute
          </>
        )}
      </button>

      {status === "error" && (
        <p className="text-xs text-red-500 text-center">{errorMsg}</p>
      )}

      {!hasBalance && (
        <p className="text-xs text-gray-400 text-center">No pending balance</p>
      )}

      {hasBalance && status === "idle" && (
        <p className="text-xs text-indigo-500 text-center">
          {pendingFormatted} USDC pending
        </p>
      )}
    </div>
  );
}
