import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  fetchPendingWaitlistEntries,
  inviteWaitlistEntry,
  WaitlistEntry,
} from "./announce-connect-ga.ts";

const pendingEntry = new WaitlistEntry({
  id: "waitlist_1",
  email_address: "person@example.com",
  status: "pending",
});

it.effect("fetches pending Clerk waitlist entries with authentication and filtering", () => {
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
            '{"data":[{"id":"waitlist_1","email_address":"person@example.com","status":"pending"}],"total_count":1}',
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

it.effect("invites a waitlist entry through Clerk's built-in invite endpoint", () => {
  const requests: Array<{
    readonly method: string;
    readonly url: string;
    readonly authorization: string | undefined;
  }> = [];
  const httpClientLayer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
      });
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            '{"id":"waitlist_1","email_address":"person@example.com","status":"invited"}',
            { headers: { "Content-Type": "application/json" } },
          ),
        ),
      );
    }),
  );

  return Effect.gen(function* () {
    const invited = yield* inviteWaitlistEntry("sk_test_secret", pendingEntry).pipe(
      Effect.provide(httpClientLayer),
    );
    assert.equal(invited.status, "invited");
    assert.deepStrictEqual(requests, [
      {
        method: "POST",
        url: "https://api.clerk.com/v1/waitlist_entries/waitlist_1/invite",
        authorization: "Bearer sk_test_secret",
      },
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
    assert.equal(error.status, 200);
  });
});
