"use server";

import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";

/** Ends the Supabase session and returns to the sign-in page. */
export async function signOut() {
  if (process.env.NEXT_PUBLIC_DEMO !== "1") {
    const db = await serverSupabase();
    await db.auth.signOut();
  }
  redirect("/login");
}
