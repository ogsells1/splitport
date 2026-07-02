"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

function appHref(path: string) {
  return APP_URL ? `${APP_URL}${path}` : path;
}

const DEMO_TEAM = [
  { name: "Maya K.", role: "Design", pct: 40, color: "bg-emerald-600" },
  { name: "Tomás R.", role: "Engineering", pct: 35, color: "bg-emerald-400" },
  { name: "Adaeze O.", role: "Marketing", pct: 25, color: "bg-amber-400" },
];

function SplitDemo() {
  const [amount, setAmount] = useState(2500);

  const shares = useMemo(
    () =>
      DEMO_TEAM.map((m) => ({
        ...m,
        share: (amount * m.pct) / 100,
      })),
    [amount]
  );

  return (
    <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(28,25,23,0.18)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-stone-500">Send to your team</p>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          Live demo
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-semibold tracking-tight text-stone-900 tabular-nums">
            ${amount.toLocaleString("en-US")}
          </span>
          <span className="text-sm text-stone-400">USDC</span>
        </div>
        <input
          type="range"
          min={100}
          max={10000}
          step={100}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="mt-3 w-full accent-emerald-600"
          aria-label="Amount to distribute"
        />
      </div>

      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full">
        {shares.map((m) => (
          <div key={m.name} className={m.color} style={{ width: `${m.pct}%` }} />
        ))}
      </div>

      <ul className="mt-4 divide-y divide-stone-100">
        {shares.map((m) => (
          <li key={m.name} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${m.color}`}
                aria-hidden
              />
              <div>
                <p className="text-sm font-medium text-stone-900">{m.name}</p>
                <p className="text-xs text-stone-400">
                  {m.role} · {m.pct}%
                </p>
              </div>
            </div>
            <p className="text-sm font-semibold text-stone-900 tabular-nums">
              ${m.share.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-2 rounded-xl bg-emerald-700 py-3 text-center text-sm font-medium text-white">
        Distribute · one click
      </div>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Fund your treasury",
    text: "Top up with a card or crypto. Your balance is held as USDC — a digital dollar, stable and instantly transferable.",
  },
  {
    n: "02",
    title: "Set the split",
    text: "Percentages or fixed amounts per person. Invite people by link — they don't need a bank account or any crypto knowledge.",
  },
  {
    n: "03",
    title: "Pay everyone at once",
    text: "One click, a schedule, or a continuous stream. Each person claims their share from a personal cabinet, anywhere in the world.",
  },
];

const FEATURES = [
  {
    title: "Recurring payroll",
    text: "Weekly or monthly auto-payouts with fixed amounts — a payroll cycle without the payroll provider.",
  },
  {
    title: "Revenue splits",
    text: "Income arrives, everyone gets their percentage. Built for collectives, agencies and rev-share deals.",
  },
  {
    title: "Streaming payouts",
    text: "Commit a budget to a time window and let earnings accrue every second. Recipients withdraw anytime.",
  },
  {
    title: "Scheduled one-offs",
    text: "Queue any number of future payments — bonuses, milestones, deferred invoices.",
  },
  {
    title: "No-crypto onboarding",
    text: "Recipients sign in with Google. A wallet is created for them, gas is covered, funds arrive in dollars.",
  },
  {
    title: "Global by default",
    text: "No SWIFT, no correspondent banks, no waiting days. If they have the internet, you can pay them.",
  },
];

export default function Home() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    // Only auto-forward signed-in users when the app lives on this host
    if (!APP_URL && ready && authenticated) {
      router.push("/dashboard");
    }
  }, [ready, authenticated, router]);

  const openApp = () => {
    if (APP_URL) {
      window.location.href = appHref("/dashboard");
    } else {
      login();
    }
  };

  return (
    <main className="min-h-screen bg-[#FAFAF8] text-stone-900 antialiased">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-700 text-xs font-bold text-white">
            S
          </div>
          <span className="text-[15px] font-semibold tracking-tight">
            Splitport
          </span>
        </div>
        <nav className="hidden items-center gap-8 text-sm text-stone-500 sm:flex">
          <a href="#how" className="hover:text-stone-900">
            How it works
          </a>
          <a href="#features" className="hover:text-stone-900">
            Features
          </a>
        </nav>
        <button
          onClick={openApp}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          {ready && authenticated ? "Open app" : "Sign in"}
        </button>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-14 lg:grid-cols-2 lg:pt-20">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Payouts settle in seconds, in USDC
          </p>
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[56px]">
            Pay your team
            <br />
            anywhere on Earth.
            <br />
            <span className="text-emerald-700">In one click.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-stone-500">
            Fund a shared treasury, set each person&apos;s share, and distribute —
            by percentage, fixed salary, schedule, or a live stream. No banks,
            no borders, no crypto skills required.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              onClick={openApp}
              className="rounded-xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800"
            >
              Start paying — it&apos;s free
            </button>
            <a
              href="#how"
              className="text-sm font-medium text-stone-600 hover:text-stone-900"
            >
              See how it works →
            </a>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-2 text-sm text-stone-400">
            <span>Card & crypto top-ups</span>
            <span>Gas fees covered</span>
            <span>Recipients need only Google</span>
          </div>
        </div>

        <div className="flex justify-center lg:justify-end">
          <SplitDemo />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            From money in to money out — three steps.
          </h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n}>
                <p className="text-sm font-semibold text-emerald-700 tabular-nums">
                  {s.n}
                </p>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-500">
                  {s.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          One treasury, every way to pay.
        </h2>
        <p className="mt-3 max-w-lg text-stone-500">
          Whether it&apos;s contractor salaries, a rev-share collective, or
          hackathon prizes — the same split engine handles it.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-stone-200 bg-white p-6"
            >
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-500">
                {f.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="rounded-3xl bg-stone-900 px-8 py-14 text-center sm:px-14">
          <h2 className="text-3xl font-semibold tracking-tight text-white">
            Your team is global. Your payouts should be too.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-stone-400">
            Create a project, drop invite links in your team chat, and send the
            first payout in under five minutes.
          </p>
          <button
            onClick={openApp}
            className="mt-8 rounded-xl bg-emerald-500 px-8 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-emerald-400"
          >
            Open Splitport
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-stone-400 sm:flex-row">
          <span>© {new Date().getFullYear()} Splitport</span>
          <span>Built on USDC · Powered by Stripe, Circle & Privy</span>
        </div>
      </footer>
    </main>
  );
}
