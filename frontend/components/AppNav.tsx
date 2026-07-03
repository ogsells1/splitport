"use client";

import { usePrivy } from "@privy-io/react-auth";

/**
 * Shared right-side header navigation. Keeps links consistent across pages
 * (Projects, Treasury, Cabinet) plus Sign out. `extra` renders before Sign out
 * for page-specific bits like a wallet-address badge.
 */
export default function AppNav({ extra }: { extra?: React.ReactNode }) {
  const { logout } = usePrivy();

  const linkCls =
    "text-sm text-stone-400 hover:text-stone-600 transition-colors";

  return (
    <div className="flex items-center gap-3">
      <a href="/dashboard" className={linkCls}>
        Projects
      </a>
      <a href="/treasury" className={linkCls}>
        Treasury
      </a>
      <a href="/cabinet" className={linkCls}>
        Cabinet
      </a>
      {extra}
      <button onClick={logout} className={linkCls}>
        Sign out
      </button>
    </div>
  );
}
