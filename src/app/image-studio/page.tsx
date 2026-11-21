import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ImageStudioRedirectPage() {
  redirect("/studio?tab=image");
}
