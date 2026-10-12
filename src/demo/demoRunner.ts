import type { LoootRun, Runner } from "@/lib/looot";

/** Stand-in for looot in demo mode. Returns invented answers for the three pinned endpoints. Makes no network call and charges nothing. */
export class DemoRunner implements Runner {
  async runAndWait(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<LoootRun> {
    const n = [...idempotencyKey].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const runId = `demo_${n.toString(16)}`;
    const base = { runId, status: "completed", actualCost: 0 };
    if (endpointId.includes("linkedin-profile")) {
      const city = ["Paris, France", "London, United Kingdom", "Lisbon, Portugal", "Berlin, Germany"][n % 4];
      return { ...base, result: { headline: "Demo profile. No call was made.", location: city, experience: [{ company: "Demo Company", title: "Demo Title", end: null }] } };
    }
    if (endpointId.includes("companies-by-email")) return { ...base, result: { industryMain: ["Fintech", "Logistics", "Climate"][n % 3], totalEmployees: 20 + (n % 400), countryCode: ["FR", "GB", "PT", "DE"][n % 4] } };
    if (endpointId.includes("linkedin-user-email")) return { ...base, result: { email: `demo.${n % 1000}@example.com` } };
    return { ...base, result: {} };
  }
}
