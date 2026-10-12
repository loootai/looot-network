import { GranolaClient } from "./client";

/** The Granola key lives in the server environment only. Returns null when it is not set. */
export function granolaFromEnv(env: Record<string, string | undefined> = process.env): GranolaClient | null {
  const key = env.GRANOLA_API_KEY?.trim();
  return key ? new GranolaClient({ apiKey: key }) : null;
}
