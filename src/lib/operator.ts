import { cookies } from "next/headers";
import {
  DEFAULT_OPERATOR,
  DEFAULT_ROLE,
  OPERATOR_COOKIE_NAME,
  ROLE_COOKIE_NAME,
  sanitizeOperatorName,
  sanitizeWorkspaceRole,
  type WorkspaceMemberIdentity,
} from "./operator-shared";

export * from "./operator-shared";

export async function getCurrentMember(): Promise<WorkspaceMemberIdentity> {
  try {
    const store = await cookies();
    const name = sanitizeOperatorName(store.get(OPERATOR_COOKIE_NAME)?.value);
    const role = sanitizeWorkspaceRole(store.get(ROLE_COOKIE_NAME)?.value);
    return { name, role };
  } catch {
    return { name: DEFAULT_OPERATOR, role: DEFAULT_ROLE };
  }
}

export async function getCurrentOperator(): Promise<string> {
  const member = await getCurrentMember();
  return member.name;
}
