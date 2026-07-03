export const metadata = {
  title: "Terms - SplitPort",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20 text-stone-700">
      <a href="/" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">
        ← Back to SplitPort
      </a>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-stone-900">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-stone-400">Preview / testnet build</p>

      <div className="mt-8 space-y-5 text-sm leading-relaxed">
        <p>
          SplitPort is a demonstration product running on Arc Testnet. All balances,
          top-ups, and payouts use test USDC with no monetary value. Nothing here is
          an offer of financial services.
        </p>
        <p>
          The service is provided “as is”, without warranty of any kind. Do not send
          real funds or mainnet assets to any address shown in the app.
        </p>
        <p>
          By using this preview you accept that data may be reset at any time and that
          SplitPort is not liable for any loss arising from use of the testnet build.
        </p>
        <p className="text-stone-400">
          A full agreement will accompany the production release. Questions:{" "}
          <a
            className="text-emerald-700 hover:text-emerald-800"
            href="https://github.com/ogsells1/splitport"
          >
            github.com/ogsells1/splitport
          </a>
          .
        </p>
      </div>
    </main>
  );
}
