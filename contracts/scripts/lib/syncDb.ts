import "dotenv/config";

type ContributorInput = { wallet: string; bps: number; role: string };

export async function syncProjectToDb(params: {
  name: string;
  contractAddress: string;
  usdcAddress: string;
  deployBlock?: number;
  contributors: ContributorInput[];
}) {
  const apiUrl = process.env.API_URL ?? "https://byn-split-pay.vercel.app";

  console.log(`\n🔄  Синхронизация проекта с БД (${apiUrl}/api/project)...`);

  const res = await fetch(`${apiUrl}/api/project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      contractAddress: params.contractAddress,
      usdcAddress: params.usdcAddress,
      deployBlock: params.deployBlock,
      contributors: params.contributors.map((c) => ({
        wallet: c.wallet,
        percentage: c.bps,
        role: c.role,
      })),
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(`❌  Не удалось синхронизировать проект с БД:`, body);
    return;
  }

  console.log(`✅  Проект синхронизирован с БД. projectId: ${body.projectId}`);
}
