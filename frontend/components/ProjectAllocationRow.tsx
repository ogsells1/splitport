"use client";

import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { USDC_ADDRESS, VAULT_ABI, USDC_ABI } from "@/lib/contract";

interface ProjectAllocationRowProps {
  name: string;
  contractAddress: Address;
  onAllocated?: () => void;
}

type Step = "idle" | "approving" | "depositing" | "done" | "error";

export function ProjectAllocationRow({ name, contractAddress, onAllocated }: ProjectAllocationRowProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  const { data: info } = useReadContract({
    address: contractAddress,
    abi: VAULT_ABI,
    functionName: "getProjectInfo",
    query: { refetchInterval: 8000 },
  });

  const vaultBalance = info?.pendingBalance ?? 0n;
  const amountParsed = amount ? parseUnits(amount, 6) : 0n;
  const busy = step === "approving" || step === "depositing";

  async function handleAllocate() {
    if (!amount || amountParsed === 0n) return;
    setErrorMsg("");
    setStep("approving");

    try {
      await writeContractAsync({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: "approve",
        args: [contractAddress, amountParsed],
      });

      setStep("depositing");
      const depositTx = await writeContractAsync({
        address: contractAddress,
        abi: VAULT_ABI,
        functionName: "depositRevenue",
        args: [amountParsed],
      });

      await publicClient?.waitForTransactionReceipt({ hash: depositTx });
      queryClient.invalidateQueries();

      fetch(`/api/transactions/sync?contractAddress=${contractAddress}`, { method: "POST" }).catch(() => {});

      setStep("done");
      setAmount("");
      onAllocated?.();
      setTimeout(() => setStep("idle"), 2000);
    } catch (e: any) {
      setErrorMsg(e?.shortMessage ?? e?.message ?? "Transaction failed");
      setStep("error");
      setTimeout(() => setStep("idle"), 4000);
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
          vault: <span className="font-semibold text-gray-900">{parseFloat(formatUnits(vaultBalance, 6)).toFixed(2)}</span> USDC
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
          disabled={!amount || amountParsed === 0n || busy || step === "done"}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
        >
          {step === "approving"
            ? "Approving..."
            : step === "depositing"
            ? "Allocating..."
            : step === "done"
            ? "✓ Done"
            : "Allocate"}
        </button>
      </div>

      {step === "error" && <p className="text-xs text-red-500 mt-1.5">{errorMsg}</p>}
    </div>
  );
}
