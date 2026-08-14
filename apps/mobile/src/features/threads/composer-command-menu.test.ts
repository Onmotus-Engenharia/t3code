import type { ServerProviderSkill } from "@t3tools/contracts";
import type { ComposerTrigger } from "@t3tools/shared/composerTrigger";
import { describe, expect, it } from "vite-plus/test";

import {
  applyComposerCommandItem,
  buildComposerCommandItems,
  shouldShowComposerCommandPopover,
} from "./composer-command-menu";

const skillTrigger: ComposerTrigger = {
  kind: "skill",
  query: "",
  rangeStart: 7,
  rangeEnd: 8,
};

const skills = [
  {
    name: "review",
    path: ".codex/skills/review/SKILL.md",
    displayName: "Code review",
    shortDescription: "Review a change",
    enabled: true,
  },
  {
    name: "disabled",
    path: ".codex/skills/disabled/SKILL.md",
    enabled: false,
  },
] as ReadonlyArray<ServerProviderSkill>;

describe("composer command menu", () => {
  it("offers enabled selected-provider skills and replaces the trigger at the cursor", () => {
    const items = buildComposerCommandItems({
      trigger: skillTrigger,
      skills,
      pathEntries: [],
      includeSlashCommands: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "skill", label: "Code review" });
    expect(
      applyComposerCommandItem({
        text: "Please $",
        trigger: skillTrigger,
        item: items[0]!,
      }),
    ).toEqual({ text: "Please $review ", cursor: 15 });
  });

  it("builds path items and replaces only the active @ query", () => {
    const trigger: ComposerTrigger = {
      kind: "path",
      query: "src/in",
      rangeStart: 7,
      rangeEnd: 14,
    };
    const items = buildComposerCommandItems({
      trigger,
      skills: [],
      pathEntries: [{ path: "src/index.ts", kind: "file" }],
      includeSlashCommands: false,
    });

    expect(items[0]).toMatchObject({
      type: "path",
      label: "index.ts",
      description: "src",
    });
    expect(
      applyComposerCommandItem({
        text: "Please @src/in now",
        trigger,
        item: items[0]!,
      }),
    ).toEqual({ text: "Please [index.ts](src/index.ts)  now", cursor: 32 });
  });

  it("waits for an @ query before showing a file menu", () => {
    expect(
      shouldShowComposerCommandPopover({
        kind: "path",
        query: "",
        rangeStart: 0,
        rangeEnd: 1,
      }),
    ).toBe(false);
    expect(
      shouldShowComposerCommandPopover({
        kind: "path",
        query: "src",
        rangeStart: 0,
        rangeEnd: 4,
      }),
    ).toBe(true);
  });
});
