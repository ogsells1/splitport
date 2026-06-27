"use client";

import { useState } from "react";
import { parseUnits, type Address } from "viem";
import { useWriteContract, usePublicClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useWallets } from "@privy-io/react-auth";
import { USDC_ADDRESS, VAULT_ABI, USDC_ABI } from "@/lib/contract";

type Step = "idle" | "approving" | "depositing" | "done" | "error";

interface DepositModalProps {
  vaultAddress: Address;
}

export function DepositModal({ vaultAddress }: DepositModalProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const { wallets } = useWallets();
  const wallet = wallets[0];

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  const amountParsed = amount ? parseUnits(amount, 6) : 0n;

  async function handleDeposit() {
    if (!wallet || !amount || amountParsed === 0n) return;

    setStep("approving");
    setErrorMsg("");

    try {
      const approveTx = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: "approve",
        args: [vaultAddress, amountParsed],
      });

      setStep("depositing");

      const depositTx = await writeContractAsync({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "depositRevenue",
        args: [amountParsed],
      });

      await publicClient?.waitForTransactionReceipt({ hash: depositTx });
      queryClient.invalidateQueries();

      fetch(`/api/transactions/sync?contractAddress=${vaultAddress}`, { method: "POST" }).catch(() => {});

      setStep("done");
      setTimeout(() => {
        setOpen(false);
        setStep("idle");
        setAmount("");
      }, 2000);
    } catch (e: any) {
      setErrorMsg(e?.shortMessage ?? e?.message ?? "Transaction failed");
      setStep("error");
    }
  }

  const stepLabel: Record<Step, string> = {
    idle: "Deposit",
    approving: "Approving USDC...",
    depositing: "Depositing...",
    done: "✓ Done!",
    error: "Try again",
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium rounded-xl transition-colors text-sm"
      >
        <span>＋</span> Deposit USDC
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Deposit USDC</h3>
          <button
            onClick={() => { setOpen(false); setStep("idle"); setAmount(""); }}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1.5">Amount</label>
          <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-indigo-400 transition-colors">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 px-4 py-3 text-gray-900 text-lg outline-none"
            />
            <span className="px-3 text-gray-400 text-sm font-medium">USDC</span>
          </div>
        </div>

        {step === "error" && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">
            {errorMsg}
          </p>
        )}

        <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 space-y-1">
          <p>1. Approve USDC spending</p>
          <p>2. Deposit to vault</p>
          <p>3. Distribute to contributors</p>
        </div>

        <button
          onClick={handleDeposit}
          disabled={!amount || amountParsed === 0n || step === "approving" || step === "depositing" || step === "done"}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-xl transition-colors text-sm"
        >
          {step === "approving" || step === "depositing" ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {stepLabel[step]}
            </span>
          ) : (
            stepLabel[step]
          )}
        </button>
      </div>
    </div>
  );
}
