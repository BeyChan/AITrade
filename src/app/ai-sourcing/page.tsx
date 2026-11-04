import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ market?: string; platform?: string; notice?: string; error?: string }>;
};

export default async function LegacyAISourcingPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const params = new URLSearchParams();

  for (const key of ["market", "platform", "notice", "error"] as const) {
    const value = query[key]?.trim();
    if (value) params.set(key, value);
  }

  const search = params.toString();
  redirect(`/${search ? `?${search}` : ""}#${query.error ? "new-research" : "research-history"}`);
}
