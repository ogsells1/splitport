"use client";

import { useState } from "react";
import { formatUnits, type Address } from "viem";
import { useReadContract } from "wagmi";
import { VAULT_ABI } from "@/lib/contract";

interface TreasuryAllocateRowProps {
  name: string;
  contractAddress: Address;
  userPrivyId: string;
  onAllocated?: () => void;
}

type Step = "idle" | "allocating" | "done" | "error";

export function TreasuryAllocateRow({
  name,
  contractAddress,
  userPrivyId,
  onAllocated,
}: TreasuryAllocateRowProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const { data: info } = useReadContract({
    address: contractAddress,
    abi: VAULT_ABI,
    functionName: "getProjectInfo",
    query: { refetchInterval: 8000 },
  });

  const vaultBalance = info?.pendingBalance ?? 0n;
  const amountNum = parseFloat(amount);
  const busy = step === "allocating";

  async function handleAllocate() {
    if (!amountNum || amountNum <= 0) return;
    setErrorMsg("");
    setStep("allocating");
    try {
      const res = await fetch("/api/treasury/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPrivyId, contractAddress, amount: amountNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Allocation failed");
      setStep("done");
      setAmount("");
      onAllocated?.();
      setTimeout(() => setStep("idle"), 2000);
    } catch (e: any) {
      setErrorMsg(e.message ?? "Allocation failed");
      setStep("error");
      setTimeout(() => setStep("idle"), 5000);
    }
  }

  return (
    <div className="px-4 py-4 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-medium text-gray-900">{name}</p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            {contractAddress.slice(0, 8)}...{contractAddress.slice(-6)}
          </p>
        </div>
        <p className="text-sm text-gray-500 whitespace-nowrap">
          vault:{" "}
          <span className="font-semibold text-gray-900">
            {parseFloat(formatUnits(vaultBalance, 6)).toFixed(2)}
          </span>{" "}
          USDC
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center border border-gray-200 rounded-lg overflow-hidden focus-within:border-indigo-400 transition-colors">
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 px-3 py-2 text-sm text-gray-900 outline-none"
          />
          <span className="px-2 text-xs text-gray-400">USDC</span>
        </div>
        <button
          onClick={handleAllocate}
          disabled={!amountNum || amountNum <= 0 || busy || step === "done"}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
        >
          {step === "allocating" ? "Allocating..." : step === "done" ? "✓ Done" : "Allocate"}
        </button>
      </div>

      {step === "error" && <p className="text-xs text-red-500 mt-1.5">{errorMsg}</p>}
    </div>
  );
}
