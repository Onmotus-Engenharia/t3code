import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  NudgeAgentControl,
  resolveRenameCommit,
  shouldShowNudgeAgentControl,
  shouldShowOpenInPicker,
  THREAD_ACTIONS_CHEVRON_CLASS,
} from "./ChatHeader";

it("keeps the thread-actions chevron visibly discoverable", () => {
  expect(THREAD_ACTIONS_CHEVRON_CLASS).toContain("opacity-70");
  expect(THREAD_ACTIONS_CHEVRON_CLASS).not.toContain("opacity-0 ");
});

describe("shouldShowOpenInPicker", () => {
  const primaryEnvironmentId = EnvironmentId.make("environment-primary");

  it("shows the picker for projects in the primary environment", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(true);
  });

  it("shows the picker for remote environments in deep-link mode", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
    ).toBe(true);
  });

  it("shows the picker's unavailable state for remote environments without an SSH route", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId: null,
        remoteOpenMode: "remote-unavailable",
      }),
    ).toBe(true);
  });

  it("hides the picker for non-primary local backends", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });

  it("hides the picker when there is no active project", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: undefined,
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
        remoteOpenMode: "remote-links",
      }),
    ).toBe(false);
  });
});

describe("resolveRenameCommit", () => {
  it("commits a trimmed changed title", () => {
    expect(resolveRenameCommit({ title: "  New title ", originalTitle: "Old" })).toEqual({
      action: "commit",
      title: "New title",
    });
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(resolveRenameCommit({ title: "   ", originalTitle: "Old" })).toEqual({
      action: "reject-empty",
    });
  });

  it("no-ops when the trimmed title is unchanged", () => {
    expect(resolveRenameCommit({ title: " Old ", originalTitle: "Old" })).toEqual({
      action: "noop",
    });
  });
});

describe("NudgeAgentControl", () => {
  it("is visible for durable server threads, including when Working", () => {
    expect(shouldShowNudgeAgentControl(true)).toBe(true);
    expect(shouldShowNudgeAgentControl(false)).toBe(false);
  });

  it("renders an accessible compact control with its tooltip while working", () => {
    const html = renderToStaticMarkup(
      createElement(NudgeAgentControl, { pending: false, onNudgeAgent: () => undefined }),
    );

    expect(html).toContain('aria-label="Nudge agent"');
    expect(html).toContain("Nudge agent");
    expect(html).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });

  it("disables only while its own nudge request is in flight", () => {
    const html = renderToStaticMarkup(
      createElement(NudgeAgentControl, { pending: true, onNudgeAgent: () => undefined }),
    );

    expect(html).toMatch(/\sdisabled(?:=|\s|>)/);
  });
});
