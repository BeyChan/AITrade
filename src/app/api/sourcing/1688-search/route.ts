import { supplier1688SearchUrl } from "@/lib/supplier-discovery";


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "跨境新品").trim().slice(0, 80) || "跨境新品";
  const target = supplier1688SearchUrl(query);
  return Response.redirect(target, 302);
}
