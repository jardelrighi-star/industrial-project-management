import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { workspaceRoles, type WorkspaceRole, type WorkspaceState } from "./state";

export class OnlineError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new OnlineError(503, "O ambiente online ainda não está configurado.");
  return value;
}

export async function sessionClient() {
  const cookieStore = await cookies();
  return createServerClient(required("SUPABASE_URL"), required("SUPABASE_PUBLISHABLE_KEY"), {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (entries) => entries.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  });
}

function databaseClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type Member = { workspaceId: string; userId: string; email: string; role: WorkspaceRole; projectCodes: string[] };

export async function requireMember(): Promise<Member> {
  const session = await sessionClient();
  const { data: { user }, error } = await session.auth.getUser();
  if (error || !user?.email) throw new OnlineError(401, "Entre com sua conta para continuar.");
  const { data: membership, error: membershipError } = await databaseClient().from("ipm_memberships")
    .select("workspace_id, role, project_codes").eq("user_id", user.id).maybeSingle();
  if (membershipError) throw new OnlineError(503, "Não foi possível consultar a configuração de acesso.");
  if (!membership || !workspaceRoles.includes(membership.role)) {
    throw new OnlineError(403, "Sua conta ainda não tem acesso à carteira.");
  }
  return { workspaceId: membership.workspace_id, userId: user.id, email: user.email, role: membership.role, projectCodes: membership.project_codes };
}

export async function loadWorkspace(workspaceId: string): Promise<WorkspaceState> {
  const { data, error } = await databaseClient().from("ipm_workspace_state")
    .select("version, payload").eq("workspace_id", workspaceId).maybeSingle();
  if (error || !data || !Number.isSafeInteger(data.version)) throw new OnlineError(503, "A base online não está disponível.");
  return { version: data.version, payload: data.payload };
}

export async function commitWorkspace(workspaceId: string, state: WorkspaceState) {
  const { data, error } = await databaseClient().from("ipm_workspace_state")
    .update({ version: state.version + 1, payload: state.payload, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId).eq("version", state.version).select("version").maybeSingle();
  if (error) throw new OnlineError(503, "Não foi possível gravar a alteração no banco.");
  if (!data) throw new OnlineError(409, "A base foi atualizada por outro usuário. Atualize a tela e tente novamente.");
}

export function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function onlineRoute(operation: () => Promise<Response>) {
  if (process.env.NEXT_PUBLIC_APP_MODE !== "online") return response({ error: "Modo online desativado." }, 404);
  try { return await operation(); }
  catch (error) {
    if (error instanceof OnlineError) return response({ error: error.message }, error.status);
    return response({ error: "Não foi possível concluir a operação online." }, 500);
  }
}

export async function readRequest(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const expectedOrigin = `${requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`;
  if (origin && origin !== expectedOrigin) throw new OnlineError(403, "Origem da solicitação inválida.");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new OnlineError(415, "Envie os dados em JSON.");
  const value: unknown = await request.json().catch(() => null);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new OnlineError(400, "Dados da solicitação inválidos.");
  return value as Record<string, unknown>;
}
