#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

const CLERK_API_URL = "https://api.clerk.com/v1";
const RESEND_API_URL = "https://api.resend.com";
const PAGE_SIZE = 500;

export class WaitlistEntry extends Schema.Class<WaitlistEntry>("WaitlistEntry")({
  id: Schema.String,
  email_address: Schema.String,
  status: Schema.Literals(["pending", "invited", "completed", "rejected"]),
}) {}

const ClerkWaitlistResponse = Schema.Struct({
  data: Schema.Array(WaitlistEntry),
  total_count: Schema.Int,
});
const ResendEmailResponse = Schema.Struct({ id: Schema.String });
const LedgerEntry = Schema.Struct({
  waitlistEntryId: Schema.String,
  resendEmailId: Schema.String,
  sentAt: Schema.String,
});
const LedgerEntriesJson = Schema.fromJsonString(Schema.Array(LedgerEntry));
const decodeLedgerEntries = Schema.decodeUnknownEffect(LedgerEntriesJson);
const encodeLedgerEntry = Schema.encodeEffect(Schema.fromJsonString(LedgerEntry));
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));

export interface ConnectGaOptions {
  readonly send: boolean;
  readonly limit: number | undefined;
  readonly ledgerPath: string;
}

const ClerkSecretKey = Config.string("CLERK_SECRET_KEY");
const ResendApiKey = Config.string("RESEND_API_KEY");
const EmailFrom = Config.string("CONNECT_GA_EMAIL_FROM");
const EmailReplyTo = Config.option(Config.string("CONNECT_GA_EMAIL_REPLY_TO"));
const SignInUrl = Config.url("CONNECT_GA_SIGN_IN_URL");

export class ConnectGaRequestError extends Schema.TaggedErrorClass<ConnectGaRequestError>()(
  "ConnectGaRequestError",
  {
    service: Schema.Literals(["Clerk", "Resend"]),
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `${this.service} ${this.operation} request failed.`;
  }
}

export class ConnectGaResponseError extends Schema.TaggedErrorClass<ConnectGaResponseError>()(
  "ConnectGaResponseError",
  {
    service: Schema.Literals(["Clerk", "Resend"]),
    operation: Schema.String,
    status: Schema.Int,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `${this.service} ${this.operation} returned status ${this.status}.`;
  }
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

const executeJsonRequest = Effect.fn("executeJsonRequest")(function* <S extends Schema.Top>(
  request: HttpClientRequest.HttpClientRequest,
  schema: S,
  context: {
    readonly service: "Clerk" | "Resend";
    readonly operation: string;
  },
) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.retryTransient({ retryOn: "errors-and-responses", times: 3 }),
  );
  const response = yield* client
    .execute(request)
    .pipe(Effect.mapError((cause) => new ConnectGaRequestError({ ...context, cause })));
  const success = yield* HttpClientResponse.filterStatusOk(response).pipe(
    Effect.mapError(
      (cause) =>
        new ConnectGaResponseError({
          ...context,
          status: response.status,
          cause,
        }),
    ),
  );
  return yield* HttpClientResponse.schemaBodyJson(schema)(success).pipe(
    Effect.mapError(
      (cause) =>
        new ConnectGaResponseError({
          ...context,
          status: response.status,
          cause,
        }),
    ),
  );
});

const fetchWaitlistPage = Effect.fn("fetchWaitlistPage")(function* (
  secretKey: string,
  offset: number,
) {
  const url = new URL(`${CLERK_API_URL}/waitlist_entries`);
  url.searchParams.set("status", "pending");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("order_by", "+created_at");

  const request = HttpClientRequest.get(url.href).pipe(
    HttpClientRequest.setHeader("Authorization", `Bearer ${secretKey}`),
    HttpClientRequest.setHeader("Clerk-API-Version", "2026-05-12"),
  );
  return yield* executeJsonRequest(request, ClerkWaitlistResponse, {
    service: "Clerk",
    operation: "list pending waitlist entries",
  });
});

export const fetchPendingWaitlistEntries = Effect.fn("fetchPendingWaitlistEntries")(function* (
  secretKey: string,
  limit?: number,
) {
  const entries: Array<WaitlistEntry> = [];
  while (true) {
    if (limit !== undefined && entries.length >= limit) break;
    const page = yield* fetchWaitlistPage(secretKey, entries.length);
    entries.push(...page.data);
    if (entries.length >= page.total_count || page.data.length === 0) break;
  }
  return limit === undefined ? entries : entries.slice(0, limit);
});

const readLedger = Effect.fn("readLedger")(function* (ledgerPath: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(ledgerPath))) return new Set<string>();
  const contents = yield* fs.readFileString(ledgerPath);
  const lines = contents.split("\n").filter(Boolean);
  const entries = yield* decodeLedgerEntries(`[${lines.join(",")}]`);
  return new Set(entries.map((entry) => entry.waitlistEntryId));
});

const sendEmail = Effect.fn("sendEmail")(function* (input: {
  readonly apiKey: string;
  readonly from: string;
  readonly replyTo: string | undefined;
  readonly entry: WaitlistEntry;
  readonly signInUrl: string;
}) {
  const email = renderConnectGaEmail(input.signInUrl);
  const request = yield* HttpClientRequest.post(`${RESEND_API_URL}/emails`).pipe(
    HttpClientRequest.setHeader("Authorization", `Bearer ${input.apiKey}`),
    HttpClientRequest.setHeader("Idempotency-Key", `connect-ga/${input.entry.id}`),
    HttpClientRequest.bodyJson({
      from: input.from,
      to: [input.entry.email_address],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  );
  return yield* executeJsonRequest(request, ResendEmailResponse, {
    service: "Resend",
    operation: `send Connect GA email for ${input.entry.id}`,
  });
});

export const announceConnectGa = Effect.fn("announceConnectGa")(function* (
  options: ConnectGaOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const clerkSecretKey = yield* ClerkSecretKey;
  const ledgerPath = path.resolve(options.ledgerPath);
  const entries = yield* fetchPendingWaitlistEntries(clerkSecretKey, options.limit);
  const sent = yield* readLedger(ledgerPath);
  const remaining = entries.filter((entry) => !sent.has(entry.id));

  yield* Effect.logInfo(options.send ? "Connect GA outreach starting" : "Connect GA dry run").pipe(
    Effect.annotateLogs({
      pendingEntries: remaining.length,
      alreadyRecorded: entries.length - remaining.length,
      ledgerPath,
    }),
  );

  if (!options.send) {
    for (const entry of remaining) {
      yield* Effect.logInfo("pending waitlist recipient").pipe(
        Effect.annotateLogs({
          waitlistEntryId: entry.id,
          emailAddress: entry.email_address,
        }),
      );
    }
    yield* Effect.logInfo("No email was sent. Re-run with --send after reviewing the list.");
    return;
  }

  const resendApiKey = yield* ResendApiKey;
  const from = yield* EmailFrom;
  const replyTo = Option.getOrUndefined(yield* EmailReplyTo);
  const signInUrl = (yield* SignInUrl).href;
  yield* fs.makeDirectory(path.dirname(ledgerPath), { recursive: true });
  let ledgerContents = (yield* fs.exists(ledgerPath)) ? yield* fs.readFileString(ledgerPath) : "";

  for (const [index, entry] of remaining.entries()) {
    const response = yield* sendEmail({
      apiKey: resendApiKey,
      from,
      replyTo,
      entry,
      signInUrl,
    });
    const encodedLedgerEntry = yield* encodeLedgerEntry({
      waitlistEntryId: entry.id,
      resendEmailId: response.id,
      sentAt: DateTime.formatIso(yield* DateTime.now),
    });
    ledgerContents += `${encodedLedgerEntry}\n`;
    yield* fs.writeFileString(ledgerPath, ledgerContents);
    yield* Effect.logInfo("Connect GA email sent").pipe(
      Effect.annotateLogs({
        waitlistEntryId: entry.id,
        completed: index + 1,
        total: remaining.length,
      }),
    );
  }
});

export const announceConnectGaCommand = Command.make(
  "announce-connect-ga",
  {
    send: Flag.boolean("send").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Send emails. Without this flag, only print a dry-run recipient list."),
    ),
    limit: Flag.integer("limit").pipe(
      Flag.withSchema(PositiveInteger),
      Flag.optional,
      Flag.withDescription("Process at most this many pending waitlist entries."),
    ),
    ledgerPath: Flag.string("ledger").pipe(
      Flag.withDefault(".t3/connect-ga-email-ledger.jsonl"),
      Flag.withDescription("Path to the idempotency ledger."),
    ),
  },
  ({ send, limit, ledgerPath }) =>
    announceConnectGa({
      send,
      limit: Option.getOrUndefined(limit),
      ledgerPath,
    }),
).pipe(
  Command.withDescription(
    "Email pending Clerk waitlist members that T3 Connect is generally available.",
  ),
);

if (import.meta.main) {
  Command.run(announceConnectGaCommand, { version: "0.0.0" }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Logger.layer([Logger.consolePretty()]),
        NodeServices.layer,
        FetchHttpClient.layer,
      ),
    ),
    NodeRuntime.runMain,
  );
}
