import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ImageStudioRedirectPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const params = new URLSearchParams();
  params.set("tab", "image");
  for (const [key, value] of Object.entries(query)) {
    if (key === "tab" || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }
  redirect(`/studio?${params.toString()}`);
}
