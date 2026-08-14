import type { ComposerPathSearchEntry } from "@t3tools/client-runtime/state/threads";
import type { ServerProviderSkill, ServerProviderSlashCommand } from "@t3tools/contracts";
import {
  replaceTextRange,
  serializeComposerFileLink,
  type ComposerTrigger,
} from "@t3tools/shared/composerTrigger";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";

export type ComposerCommandItem =
  | {
      readonly id: string;
      readonly type: "path";
      readonly path: string;
      readonly kind: "file" | "directory";
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "slash-command";
      readonly command: string;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "provider-slash-command";
      readonly command: ServerProviderSlashCommand;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "skill";
      readonly skill: ServerProviderSkill;
      readonly label: string;
      readonly description: string;
    };

const builtInSlashCommands = [
  {
    id: "cmd:model",
    type: "slash-command" as const,
    command: "model",
    label: "/model",
    description: "Switch model",
  },
  {
    id: "cmd:plan",
    type: "slash-command" as const,
    command: "plan",
    label: "/plan",
    description: "Switch to plan mode",
  },
  {
    id: "cmd:default",
    type: "slash-command" as const,
    command: "default",
    label: "/default",
    description: "Switch to default mode",
  },
];

export function shouldShowComposerCommandPopover(
  trigger: ComposerTrigger | null,
  options?: { readonly includeSlashCommands?: boolean },
): boolean {
  if (!trigger || trigger.kind === "slash-model") {
    return false;
  }
  if (trigger.kind === "path") {
    return trigger.query.trim().length > 0;
  }
  return trigger.kind !== "slash-command" || options?.includeSlashCommands !== false;
}

export function buildComposerCommandItems(input: {
  readonly trigger: ComposerTrigger | null;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly slashCommands?: ReadonlyArray<ServerProviderSlashCommand>;
  readonly pathEntries: ReadonlyArray<ComposerPathSearchEntry>;
  readonly includeSlashCommands?: boolean;
}): ReadonlyArray<ComposerCommandItem> {
  const { trigger } = input;
  if (!trigger) return [];

  if (trigger.kind === "slash-command") {
    if (input.includeSlashCommands === false) {
      return [];
    }
    const query = trigger.query.toLowerCase();
    const builtIn = builtInSlashCommands.filter((item) => item.command.includes(query));
    const providerCommands = (input.slashCommands ?? [])
      .filter((command) => command.name.toLowerCase().includes(query))
      .map((command) => ({
        id: `pcmd:${command.name}`,
        type: "provider-slash-command" as const,
        command,
        label: `/${command.name}`,
        description: command.description ?? "",
      }));

    return [...builtIn, ...providerCommands];
  }

  if (trigger.kind === "skill") {
    const enabledSkills = input.skills.filter((skill) => skill.enabled);
    const normalizedQuery = normalizeSearchQuery(trigger.query, {
      trimLeadingPattern: /^\$+/,
    });

    if (!normalizedQuery) {
      return enabledSkills.slice(0, 20).map((skill) => toSkillCommandItem(skill));
    }

    const ranked: Array<{
      item: ServerProviderSkill;
      score: number;
      tieBreaker: string;
    }> = [];
    for (const skill of enabledSkills) {
      const displayLabel = (skill.displayName ?? skill.name).toLowerCase();
      const scores = [
        scoreQueryMatch({
          value: skill.name.toLowerCase(),
          query: normalizedQuery,
          exactBase: 0,
          prefixBase: 2,
          boundaryBase: 4,
          includesBase: 6,
          fuzzyBase: 100,
          boundaryMarkers: ["-", "_", "/"],
        }),
        scoreQueryMatch({
          value: displayLabel,
          query: normalizedQuery,
          exactBase: 1,
          prefixBase: 3,
          boundaryBase: 5,
          includesBase: 7,
          fuzzyBase: 110,
        }),
        scoreQueryMatch({
          value: skill.shortDescription?.toLowerCase() ?? "",
          query: normalizedQuery,
          exactBase: 20,
          prefixBase: 22,
          boundaryBase: 24,
          includesBase: 26,
        }),
        scoreQueryMatch({
          value: skill.description?.toLowerCase() ?? "",
          query: normalizedQuery,
          exactBase: 30,
          prefixBase: 32,
          boundaryBase: 34,
          includesBase: 36,
        }),
      ].filter((score): score is number => score !== null);

      if (scores.length > 0) {
        insertRankedSearchResult(
          ranked,
          {
            item: skill,
            score: Math.min(...scores),
            tieBreaker: `${displayLabel}\u0000${skill.name}`,
          },
          20,
        );
      }
    }

    return ranked.map(({ item }) => toSkillCommandItem(item));
  }

  if (trigger.kind === "path") {
    return input.pathEntries.map((entry) => {
      const parts = entry.path.split("/");
      return {
        id: `path:${entry.path}`,
        type: "path" as const,
        path: entry.path,
        kind: entry.kind,
        label: parts[parts.length - 1] ?? entry.path,
        description: parts.length > 1 ? parts.slice(0, -1).join("/") : "",
      };
    });
  }

  return [];
}

export function applyComposerCommandItem(input: {
  readonly text: string;
  readonly trigger: ComposerTrigger;
  readonly item: ComposerCommandItem;
}): { text: string; cursor: number } {
  let replacement = "";
  switch (input.item.type) {
    case "path":
      replacement = `${serializeComposerFileLink(input.item.path)} `;
      break;
    case "skill":
      replacement = `$${input.item.skill.name} `;
      break;
    case "slash-command":
      replacement = `/${input.item.command} `;
      break;
    case "provider-slash-command":
      replacement = `/${input.item.command.name} `;
      break;
  }

  return replaceTextRange(
    input.text,
    input.trigger.rangeStart,
    input.trigger.rangeEnd,
    replacement,
  );
}

function toSkillCommandItem(skill: ServerProviderSkill): ComposerCommandItem {
  return {
    id: `skill:${skill.name}`,
    type: "skill",
    skill,
    label: skill.displayName ?? skill.name,
    description: skill.shortDescription ?? skill.description ?? "",
  };
}
