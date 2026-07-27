// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalFetch:off
// @effect-diagnostics globalConsole:off
// @effect-diagnostics globalDate:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const CLERK_API_URL = "https://api.clerk.com/v1";
const RESEND_API_URL = "https://api.resend.com";
const PAGE_SIZE = 500;

export interface WaitlistEntry {
  readonly id: string;
  readonly email_address: string;
  readonly status: "pending" | "invited" | "completed" | "rejected";
}

interface ClerkWaitlistResponse {
  readonly data: readonly WaitlistEntry[];
  readonly total_count: number;
}

interface Options {
  readonly send: boolean;
  readonly limit: number | undefined;
  readonly ledgerPath: string;
}

export function parseOptions(args: readonly string[], cwd = process.cwd()): Options {
  let send = false;
  let limit: number | undefined;
  let ledgerPath = NodePath.resolve(cwd, ".t3/connect-ga-email-ledger.jsonl");

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--send") {
      send = true;
    } else if (argument === "--limit") {
      const value = Number(args[index + 1]);
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("--limit must be followed by a positive integer.");
      }
      limit = value;
      index += 1;
    } else if (argument === "--ledger") {
      const value = args[index + 1];
      if (!value) throw new Error("--ledger must be followed by a file path.");
      ledgerPath = NodePath.resolve(cwd, value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { send, limit, ledgerPath };
}

export function renderConnectGaEmail(signInUrl: string): {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
} {
  const subject = "T3 Connect is open — you can sign in now";
  const text = `Hey!

You signed up for the T3 Connect waitlist, and I wanted to personally let you know that the wait is over. T3 Connect is now open to everyone.

You can sign in here: ${signInUrl}

Thanks for being early,
Julius`;
  const html = `<p>Hey!</p>
<p>You signed up for the T3 Connect waitlist, and I wanted to personally let you know that the wait is over. T3 Connect is now open to everyone.</p>
<p><a href="${signInUrl}">Sign in to T3 Connect</a></p>
<p>Thanks for being early,<br>Julius</p>`;
  return { subject, html, text };
}

async function clerkRequest(secretKey: string, offset: number): Promise<ClerkWaitlistResponse> {
  const url = new URL(`${CLERK_API_URL}/waitlist_entries`);
  url.searchParams.set("status", "pending");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("order_by", "+created_at");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Clerk-API-Version": "2026-05-12",
    },
  });
  if (!response.ok) {
    throw new Error(`Clerk waitlist request failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as ClerkWaitlistResponse;
}

export async function fetchPendingWaitlistEntries(
  secretKey: string,
  limit?: number,
): Promise<readonly WaitlistEntry[]> {
  const entries: WaitlistEntry[] = [];
  while (true) {
    if (limit !== undefined && entries.length >= limit) break;
    const page = await clerkRequest(secretKey, entries.length);
    entries.push(...page.data);
    if (entries.length >= page.total_count || page.data.length === 0) break;
  }
  return limit === undefined ? entries : entries.slice(0, limit);
}

async function readLedger(path: string): Promise<Set<string>> {
  const contents = await NodeFSP.readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  return new Set(
    contents
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { readonly waitlistEntryId: string }).waitlistEntryId),
  );
}

async function sendEmail(input: {
  readonly apiKey: string;
  readonly from: string;
  readonly replyTo: string | undefined;
  readonly entry: WaitlistEntry;
  readonly signInUrl: string;
}): Promise<string> {
  const email = renderConnectGaEmail(input.signInUrl);
  const response = await fetch(`${RESEND_API_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `connect-ga/${input.entry.id}`,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.entry.email_address],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Resend request failed for ${input.entry.id} (${response.status}): ${await response.text()}`,
    );
  }
  return ((await response.json()) as { readonly id: string }).id;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) throw new Error("CLERK_SECRET_KEY is required.");

  const entries = await fetchPendingWaitlistEntries(clerkSecretKey, options.limit);
  const sent = await readLedger(options.ledgerPath);
  const remaining = entries.filter((entry) => !sent.has(entry.id));

  console.log(
    `${options.send ? "Sending to" : "Dry run:"} ${remaining.length} pending waitlist ${remaining.length === 1 ? "entry" : "entries"} (${entries.length - remaining.length} already recorded).`,
  );
  if (!options.send) {
    for (const entry of remaining) console.log(`${entry.id}\t${entry.email_address}`);
    console.log("No email was sent. Re-run with --send after reviewing this list.");
    return;
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONNECT_GA_EMAIL_FROM;
  const signInUrl = process.env.CONNECT_GA_SIGN_IN_URL;
  if (!resendApiKey) throw new Error("RESEND_API_KEY is required with --send.");
  if (!from) throw new Error("CONNECT_GA_EMAIL_FROM is required with --send.");
  if (!signInUrl) throw new Error("CONNECT_GA_SIGN_IN_URL is required with --send.");

  await NodeFSP.mkdir(NodePath.dirname(options.ledgerPath), { recursive: true });
  for (const [index, entry] of remaining.entries()) {
    const resendEmailId = await sendEmail({
      apiKey: resendApiKey,
      from,
      replyTo: process.env.CONNECT_GA_EMAIL_REPLY_TO,
      entry,
      signInUrl,
    });
    await NodeFSP.appendFile(
      options.ledgerPath,
      `${JSON.stringify({ waitlistEntryId: entry.id, resendEmailId, sentAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    console.log(`[${index + 1}/${remaining.length}] Sent ${entry.id}`);
  }
}

if (import.meta.main) {
  await main();
}
