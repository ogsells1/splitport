"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig, arcTestnet } from "@/lib/wagmi";

const queryClient = new QueryClient();

// Inlined SplitPort mark as a data URI. Privy's login modal does not reliably
// resolve relative asset paths (and can differ across preview/prod domains),
// so we embed the SVG directly to guarantee it renders.
const LOGO_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="32" viewBox="0 0 150 32"><rect width="32" height="32" rx="7" fill="#047857"/><g fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(-33 7 16)"><path d="M7 16h14M16.5 11.5 21 16l-4.5 4.5"/></g><path d="M7 16h14M16.5 11.5 21 16l-4.5 4.5"/><g transform="rotate(33 7 16)"><path d="M7 16h14M16.5 11.5 21 16l-4.5 4.5"/></g></g><text x="40" y="21.5" font-family="Inter, -apple-system, 'Segoe UI', sans-serif" font-size="17" font-weight="600" letter-spacing="-0.3" fill="#1c1917">SplitPort</text></svg>`
  );

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["google", "email", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#047857",
          logo: LOGO_DATA_URI,
        },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
