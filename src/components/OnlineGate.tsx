"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { onlinePost, onlineRequest } from "../lib/online/client";
import type { OnlineSession } from "../lib/online/state";

export default function OnlineGate({ children }: { children: (session: OnlineSession, logout: () => void) => ReactNode }) {
  const [session, setSession] = useState<OnlineSession | null | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const expire = () => { if (active) setSession(null); };
    window.addEventListener("ipm-session-expired", expire);
    void onlineRequest<OnlineSession>("/api/session").then((user) => {
      if (active) setSession(user);
    }).catch((cause: Error) => {
      if (active) {
        setSession(null);
        if (cause.message !== "Entre com sua conta para continuar.") setError(cause.message);
      }
    });
    return () => { active = false; window.removeEventListener("ipm-session-expired", expire); };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      setSession(await onlinePost<OnlineSession>("/api/session", { action: "login", email: fields.get("email"), password: fields.get("password") }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar.");
    } finally { setBusy(false); }
  }

  async function logout() {
    try {
      await onlinePost("/api/session", { action: "logout" });
      setSession(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível sair.");
    }
  }

  if (session) return <>{error && <p role="alert" className="bg-red-50 p-3 text-sm text-red-800">{error}</p>}{children(session, () => void logout())}</>;
  if (session === undefined) return <main className="p-6" role="status">Consultando sua sessão…</main>;
  return <main className="grid min-h-screen place-items-center bg-slate-100 p-4">
    <form onSubmit={(event) => void login(event)} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold">Entrar na carteira de projetos</h1>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <label className="block text-sm font-medium">E-mail
        <input name="email" type="email" autoComplete="username" required className="mt-1 w-full rounded-lg border px-3 py-2" />
      </label>
      <label className="block text-sm font-medium">Senha
        <input name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded-lg border px-3 py-2" />
      </label>
      <button disabled={busy} className="w-full rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Entrando…" : "Entrar"}</button>
    </form>
  </main>;
}
