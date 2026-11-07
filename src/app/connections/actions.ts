"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearConnectorSettings, saveConnectorSettings } from "@/lib/connector-settings";

const RETURN_PATH = "/connections";

function withQuery(key: "notice" | "error", message: string) {
  return `${RETURN_PATH}?${key}=${encodeURIComponent(message)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

function revalidateConnectorPages() {
  revalidatePath("/connections");
  revalidatePath("/data-sources");
  revalidatePath("/");
}

export async function saveConnectorSettingsAction(formData: FormData) {
  const code = String(formData.get("code") || "").trim();
  const actor = String(formData.get("actor") || "本机管理员").trim();
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "code" || key === "actor" || key.startsWith("$ACTION")) continue;
    if (typeof value === "string") values[key] = value;
  }

  let notice = "";
  try {
    const count = await saveConnectorSettings(code, values, actor);
    notice = `已保存 ${count} 项凭证设置；加密存储、页面不回显，运行只读检查无需重启服务`;
  } catch (error) {
    redirect(withQuery("error", errorMessage(error)));
  }
  revalidateConnectorPages();
  redirect(withQuery("notice", notice));
}

export async function clearConnectorSettingsAction(formData: FormData) {
  const code = String(formData.get("code") || "").trim();
  const actor = String(formData.get("actor") || "本机管理员").trim();

  let notice = "";
  try {
    const count = await clearConnectorSettings(code, actor);
    notice = `已清除 ${count} 项已保存配置，回到环境变量或「未配置」状态`;
  } catch (error) {
    redirect(withQuery("error", errorMessage(error)));
  }
  revalidateConnectorPages();
  redirect(withQuery("notice", notice));
}
