"use client";

import { useState } from "react";
import { authedFetch } from "@/lib/apiClient";

interface TreasuryDistributeRowProps {
  name: string;
  contractAddress: string;
  ownerPrivyId: string;
  onDistributed?: () => void;
}

type Step = "idle" | "distributing" | "done" | "error";

export function TreasuryDistributeRow({
  name,
  contractAddress,
  ownerPrivyId,
  onDistributed,
}: TreasuryDistributeRowProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const amountNum = parseFloat(amount);
  const busy = step === "distributing";

  async function handleDistribute() {
    if (!amountNum || amountNum <= 0) return;
    setErrorMsg("");
    setStep("distributing");
    try {
      const res = await authedFetch("/api/treasury/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerPrivyId, contractAddress, amount: amountNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Distribution failed");
      setStep("done");
      setAmount("");
      onDistributed?.();
      setTimeout(() => setStep("idle"), 2000);
    } catch (e: any) {
      setErrorMsg(e.message ?? "Distribution failed");
      setStep("error");
      setTimeout(() => setStep("idle"), 6000);
    }
  }

  return (
    <div className="px-4 py-4 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            {contractAddress.slice(0, 8)}...{contractAddress.slice(-6)}
          </p>
        </div>
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
          onClick={handleDistribute}
          disabled={!amountNum || amountNum <= 0 || busy || step === "done"}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
        >
          {step === "distributing" ? "Distributing..." : step === "done" ? "✓ Done" : "Distribute"}
        </button>
      </div>

      {step === "error" && <p className="text-xs text-red-500 mt-1.5">{errorMsg}</p>}
    </div>
  );
}
