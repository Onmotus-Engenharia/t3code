import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { fetchPendingWaitlistEntries, renderConnectGaEmail } from "./announce-connect-ga.ts";

it("renders a personal plain-text and HTML announcement", () => {
  const email = renderConnectGaEmail("https://example.com/sign-in");
  assert.ok(email.subject.includes("T3 Connect"));
  assert.ok(email.text.includes("Julius"));
  assert.ok(email.text.includes("https://example.com/sign-in"));
  assert.ok(email.html.includes('href="https://example.com/sign-in"'));
});

it.effect("fetches and schema-decodes pending Clerk waitlist entries", () => {
  const requests: Array<{
    readonly authorization: string | undefined;
    readonly status: string | null;
  }> = [];
  const httpClientLayer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const url = new URL(request.url);
      requests.push({
        authorization: request.headers.authorization,
        status: url.searchParams.get("status"),
      });
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "waitlist_1",
                  email_address: "person@example.com",
                  status: "pending",
                },
              ],
              total_count: 1,
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        ),
      );
    }),
  );

  return Effect.gen(function* () {
    const entries = yield* fetchPendingWaitlistEntries("sk_test_secret").pipe(
      Effect.provide(httpClientLayer),
    );
    assert.deepStrictEqual(
      entries.map((entry) => ({
        id: entry.id,
        emailAddress: entry.email_address,
        status: entry.status,
      })),
      [{ id: "waitlist_1", emailAddress: "person@example.com", status: "pending" }],
    );
    assert.deepStrictEqual(requests, [
      { authorization: "Bearer sk_test_secret", status: "pending" },
    ]);
  });
});

it.effect("returns a typed response error when Clerk returns malformed JSON", () => {
  const httpClientLayer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response('{"data":"not-an-array","total_count":1}', {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    ),
  );

  return Effect.gen(function* () {
    const error = yield* fetchPendingWaitlistEntries("sk_test_secret").pipe(
      Effect.provide(httpClientLayer),
      Effect.flip,
    );
    if (error._tag !== "ConnectGaResponseError") {
      assert.fail(`Unexpected error: ${error._tag}`);
    }
    assert.equal(error.service, "Clerk");
    assert.equal(error.status, 200);
  });
});
