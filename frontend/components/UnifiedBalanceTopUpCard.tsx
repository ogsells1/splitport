"use client";

import { useState } from "react";
import { authedFetch } from "@/lib/apiClient";

// Tops up the treasury via Circle's Unified Balance Kit (Gateway v1): USDC
// already held on Base Sepolia is deposited into Gateway, then spent (minted)
// directly onto Arc - no manual bridging step, one balance across chains.
// Additive to the card and direct-on-chain-transfer top-ups above.
export default function UnifiedBalanceTopUpCard({ onCredited }: { onCredited: () => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"idle" | "depositing" | "waiting" | "spending">("idle");
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");

  async function run() {
    setError("");
    setBanner("");
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setBusy(true);
    try {
      setStep("depositing");
      const depositRes = await authedFetch("/api/treasury/deposit-unified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deposit", source: "base-sepolia", amount }),
      });
      const deposit = await depositRes.json();
      if (!depositRes.ok) throw new Error(deposit.error ?? "Gateway deposit failed");

      // Gateway needs the source-chain deposit to reach finality before it can
      // be spent elsewhere - poll spend until the balance is confirmed.
      setStep("waiting");
      let spend: any = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((r) => setTimeout(r, 15_000));
        setStep("spending");
        const spendRes = await authedFetch("/api/treasury/deposit-unified", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "spend", source: "base-sepolia", amount }),
        });
        const data = await spendRes.json();
        if (spendRes.ok) {
          spend = data;
          break;
        }
        if (!/insufficient/i.test(data.error ?? "")) throw new Error(data.error ?? "Gateway spend failed");
        setStep("waiting");
      }
      if (!spend) throw new Error("Gateway deposit is still finalizing - try again in a minute.");

      setBanner(`Treasury topped up with ${amount} USDC via Unified Balance. ✓`);
      setAmount("");
      onCredited();
    } catch (e: any) {
      setError(e.message ?? "Unified Balance top-up failed");
    } finally {
      setBusy(false);
      setStep("idle");
    }
  }

  const stepLabel = {
    idle: "Top up from Base Sepolia",
    depositing: "Depositing into Gateway...",
    waiting: "Waiting for finality...",
    spending: "Minting on Arc...",
  }[step];

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
      <div>
        <p className="font-medium text-stone-900 text-sm">Top up via Unified Balance</p>
        <p className="text-xs text-stone-400 mt-0.5">
          Circle Gateway - USDC on Base Sepolia becomes spendable on Arc in one flow, no manual bridge.
        </p>
      </div>
      <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden focus-within:border-emerald-500">
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          className="flex-1 px-2 py-2 text-sm outline-none"
        />
        <span className="px-2 text-sm text-stone-400">USDC</span>
      </div>
      <button
        onClick={run}
        disabled={busy}
        className="w-full py-2.5 bg-stone-800 hover:bg-stone-900 disabled:bg-stone-400 text-white font-medium rounded-xl transition-colors text-sm"
      >
        {stepLabel}
      </button>
      {banner && <p className="text-xs text-emerald-700">{banner}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
