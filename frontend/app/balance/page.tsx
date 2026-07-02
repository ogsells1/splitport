"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The treasury is now the single source for funding projects. The old
// wallet → project allocation flow lived here; /balance now redirects to
// /treasury, where the wallet balance is also shown.
export default function BalanceRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/treasury");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
