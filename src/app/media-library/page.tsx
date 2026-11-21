import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function MediaLibraryRedirectPage() {
  redirect("/studio?tab=library");
}
