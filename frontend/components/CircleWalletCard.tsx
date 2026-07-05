"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/apiClient";
import type { Address } from "viem";

// Lets a contributor generate a Circle User-Controlled Wallet (PIN-secured,
// created on ARC-TESTNET) and use it as their payout destination instead of
// their Privy embedded wallet. Additive - the Privy wallet stays the identity
// used to authenticate every request; only the on-chain transfer target changes.
export default function CircleWalletCard({ wallet }: { wallet: Address }) {
  const [circleWallet, setCircleWallet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"idle" | "creating" | "confirming">("idle");

  async function loadStatus() {
    try {
      const res = await authedFetch(`/api/cabinet/circle-wallet?wallet=${wallet}`);
      const data = await res.json();
      if (res.ok) setCircleWallet(data.circleWallet ?? null);
    } catch {}
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  async function createCircleWallet() {
    setError("");
    setBusy(true);
    setStep("creating");
    try {
      const initRes = await authedFetch("/api/cabinet/circle-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, action: "init" }),
      });
      const init = await initRes.json();
      if (!initRes.ok) throw new Error(init.error ?? "Could not start Circle Wallet setup");

      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
      const sdk = new W3SSdk({
        appSettings: { appId: init.appId },
        authentication: { userToken: init.userToken, encryptionKey: init.encryptionKey },
      });

      setStep("confirming");
      sdk.execute(init.challengeId, async (error) => {
        if (error) {
          setError(error.message ?? "PIN setup was cancelled or failed");
          setBusy(false);
          setStep("idle");
          return;
        }
        try {
          const confirmRes = await authedFetch("/api/cabinet/circle-wallet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wallet, action: "confirm" }),
          });
          const confirm = await confirmRes.json();
          if (!confirmRes.ok) throw new Error(confirm.error ?? "Could not confirm the new wallet");
          setCircleWallet(confirm.circleWallet);
        } catch (e: any) {
          setError(e.message ?? "Could not confirm the new wallet");
        } finally {
          setBusy(false);
          setStep("idle");
        }
      });
    } catch (e: any) {
      setError(e.message ?? "Could not start Circle Wallet setup");
      setBusy(false);
      setStep("idle");
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
      <div>
        <p className="text-sm font-medium text-stone-900">Circle Wallet (optional)</p>
        <p className="text-sm text-stone-500 mt-0.5">
          Create a PIN-secured Circle wallet on Arc Testnet and receive future claims there
          instead of your built-in wallet - no seed phrase, secured by a PIN only you know.
        </p>
      </div>

      {circleWallet ? (
        <div className="bg-emerald-50 text-emerald-800 text-xs rounded-xl px-4 py-3 space-y-1">
          <p className="font-medium">Active payout destination</p>
          <p className="font-mono break-all">{circleWallet}</p>
        </div>
      ) : (
        <button
          onClick={createCircleWallet}
          disabled={busy}
          className="w-full py-2.5 border border-stone-200 hover:bg-stone-50 disabled:opacity-60 text-stone-700 text-sm font-medium rounded-xl transition-colors"
        >
          {step === "creating" && "Starting..."}
          {step === "confirming" && "Complete the PIN setup..."}
          {step === "idle" && "Create Circle Wallet"}
        </button>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
