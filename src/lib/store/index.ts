import "server-only";
import { redirect } from "next/navigation";
import { seedDemo } from "@/demo/seed";
import { accessFor, type AccessState } from "../access";
import { serverSupabase } from "../supabase/server";
import { MemoryStore } from "./memoryStore";
import { SupabaseStore } from "./supabaseStore";
import type { NetworkStore } from "./types";

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

const g = globalThis as unknown as { __loootNetworkDemo?: MemoryStore };

/**
 * The demo store lives in the server process. Writes last until the process restarts. Demo mode refuses to run next
 * to a real looot token: it has no sign-in, so anyone who reached it could spend that balance.
 */
export function demoStore(): MemoryStore {
  if (process.env.LOOOT_TOKEN?.trim()) throw new Error("Demo mode has no sign-in and refuses to run while LOOOT_TOKEN is set. Unset it, or turn the demo off.");
  if (!g.__loootNetworkDemo) g.__loootNetworkDemo = new MemoryStore({ demo: true }, seedDemo());
  return g.__loootNetworkDemo;
}

export interface Session {
  store: NetworkStore;
  user: { id: string; email: string; name: string };
}

export type Gate = { kind: "anon" } | { kind: "setup" } | { kind: "denied"; email: string } | { kind: "ok"; session: Session };

/** Who is asking and whether the allow-list lets them in. Demo mode is always "ok" and never creates a Supabase client. */
export async function resolveGate(): Promise<Gate> {
  if (IS_DEMO) return { kind: "ok", session: { store: demoStore(), user: { id: "demo", email: "demo@example.com", name: "Demo" } } };
  const db = await serverSupabase();
  const { data } = await db.auth.getUser();
  if (!data.user) return { kind: "anon" };
  const email = data.user.email ?? "";
  const state: AccessState = accessFor(data.user);
  if (state === "setup") return { kind: "setup" };
  if (state === "denied") return { kind: "denied", email };
  const name = (data.user.user_metadata?.full_name as string | undefined) ?? email.split("@")[0] ?? "You";
  return { kind: "ok", session: { store: new SupabaseStore(db), user: { id: data.user.id, email, name } } };
}

/** For pages: the store, or a redirect to /login. */
export async function requireSession(): Promise<Session> {
  const gate = await resolveGate();
  if (gate.kind === "anon") redirect("/login");
  if (gate.kind === "setup") redirect("/setup");
  if (gate.kind === "denied") redirect("/not-authorised");
  return gate.session;
}

export type { NetworkStore } from "./types";
