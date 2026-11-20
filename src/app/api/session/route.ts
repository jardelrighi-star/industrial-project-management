import { OnlineError, onlineRoute, readRequest, requireMember, response, sessionClient } from "../../../lib/online/server";

export function GET() {
  return onlineRoute(async () => {
    const { email, role } = await requireMember();
    return response({ email, role });
  });
}

export function POST(request: Request) {
  return onlineRoute(async () => {
    const body = await readRequest(request);
    const client = await sessionClient();
    if (body.action === "logout") {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error && error.status !== 401 && error.status !== 403 && error.name !== "AuthSessionMissingError") throw new OnlineError(503, "Não foi possível encerrar a sessão.");
      return response({ ok: true });
    }
    if (body.action !== "login" || typeof body.email !== "string" || typeof body.password !== "string" ||
      !body.email.trim() || !body.password || body.email.length > 254 || body.password.length > 1024) throw new OnlineError(400, "Informe e-mail e senha.");
    const { error } = await client.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (error) {
      if (error.status === 429) throw new OnlineError(429, "Muitas tentativas. Aguarde antes de tentar novamente.");
      throw new OnlineError(401, "Verifique o e-mail e a senha.");
    }
    try {
      const { email, role } = await requireMember();
      return response({ email, role });
    } catch (cause) {
      await client.auth.signOut({ scope: "local" });
      throw cause;
    }
  });
}
