"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) {
      router.push("/dashboard");
    }
  }, [ready, authenticated, router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <h1 className="text-4xl font-semibold text-gray-900 tracking-tight">
            BYN Split Pay
          </h1>
          <p className="mt-3 text-lg text-gray-500">
            Automatic revenue distribution for music projects
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-4">
          <p className="text-sm text-gray-500">
            Powered by USDC on Arc blockchain
          </p>

          <button
            onClick={login}
            className="w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors"
          >
            Sign in
          </button>

          <p className="text-xs text-gray-400">
            Google, email, or existing wallet
          </p>
        </div>

        <div className="flex justify-center gap-8 text-sm text-gray-400">
          <span>✓ Non-custodial</span>
          <span>✓ On-chain splits</span>
          <span>✓ USDC payouts</span>
        </div>
      </div>
    </main>
  );
}
