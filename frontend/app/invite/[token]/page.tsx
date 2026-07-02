"use client";

import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { authedFetch } from "@/lib/apiClient";

type InviteInfo = {
  projectName: string;
  role: string;
  percentage: number;
  fixedAmount: string | null;
  splitMode: "PERCENTAGE" | "FIXED";
  status: "PENDING" | "CLAIMED";
};

export default function InvitePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [claimState, setClaimState] = useState<"idle" | "claiming" | "done" | "error">("idle");
  const [claimError, setClaimError] = useState("");

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "Invite not found");
        return res.json();
      })
      .then(setInvite)
      .catch((e) => setLoadError(e.message));
  }, [token]);

  const walletAddress = wallets[0]?.address;

  async function handleClaim() {
    if (!user || !walletAddress) return;
    setClaimState("claiming");
    setClaimError("");
    try {
      const res = await authedFetch(`/api/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to claim invite");
      setClaimState("done");
    } catch (e: any) {
      setClaimError(e.message ?? "Something went wrong");
      setClaimState("error");
    }
  }

  if (loadError) {
    return (
      <Centered>
        <p className="text-red-500 text-sm">{loadError}</p>
      </Centered>
    );
  }

  if (!invite) {
    return (
      <Centered>
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </Centered>
    );
  }

  if (invite.status === "CLAIMED" && claimState !== "done") {
    return (
      <Centered>
        <p className="text-stone-600 text-sm text-center">
          This invite has already been claimed.
        </p>
      </Centered>
    );
  }

  if (claimState === "done") {
    return (
      <Centered>
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-2xl">✓</p>
          <p className="text-stone-900 font-medium">You&apos;re in!</p>
          <p className="text-stone-500 text-sm">
            Your wallet is linked. When the project owner sends out payments, your share will show
            up in your cabinet — sign in any time to claim it to your wallet.
          </p>
          <a
            href="/cabinet"
            className="inline-block w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-xl transition-colors text-sm"
          >
            Go to your cabinet
          </a>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="w-full max-w-sm space-y-5 text-center">
        <div>
          <p className="text-stone-400 text-xs uppercase tracking-wide">You&apos;re invited to</p>
          <h1 className="text-xl font-semibold text-stone-900">{invite.projectName}</h1>
        </div>

        <div className="bg-stone-50 rounded-xl p-4 space-y-1">
          <p className="text-sm text-stone-500">Role</p>
          <p className="font-medium text-stone-900">{invite.role}</p>
          <p className="text-sm text-stone-500 mt-2">Share</p>
          <p className="font-medium text-stone-900">
            {invite.splitMode === "FIXED" && invite.fixedAmount != null
              ? `${(Number(invite.fixedAmount) / 1e6).toFixed(2)} USDC per payout`
              : `${(invite.percentage / 100).toFixed(2)}%`}
          </p>
        </div>

        {!ready ? (
          <div className="w-6 h-6 mx-auto border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        ) : !authenticated ? (
          <button
            onClick={login}
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-xl transition-colors text-sm"
          >
            Sign in to claim
          </button>
        ) : !walletAddress ? (
          <p className="text-sm text-stone-500">Setting up your wallet...</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-stone-400 font-mono break-all">{walletAddress}</p>
            <button
              onClick={handleClaim}
              disabled={claimState === "claiming"}
              className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-300 text-white font-medium rounded-xl transition-colors text-sm"
            >
              {claimState === "claiming" ? "Linking wallet..." : "Link this wallet"}
            </button>
            {claimState === "error" && (
              <p className="text-sm text-red-500">{claimError}</p>
            )}
          </div>
        )}

        <p className="text-xs text-stone-400">
          The project owner will only see your wallet address — not your identity.
        </p>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white">
      {children}
    </div>
  );
}
