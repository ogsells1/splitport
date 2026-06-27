"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardRedirect() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      router.push("/");
      return;
    }

    fetch(`/api/projects?ownerPrivyId=${encodeURIComponent(user!.id)}`)
      .then((r) => r.json())
      .then((d) => {
        const first = d.projects?.[0];
        router.push(first ? `/dashboard/${first.contractAddress}` : "/create");
      })
      .catch(() => router.push("/create"));
  }, [ready, authenticated, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
