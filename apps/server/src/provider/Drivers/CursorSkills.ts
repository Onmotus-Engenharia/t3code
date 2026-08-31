/**
 * Cursor skill discovery and invocation loading.
 *
 * Cursor's user-local skill roots are intentionally the only roots this
 * module inspects. The catalog reads both roots recursively, with personal
 * skills winning over Cursor-provided skills by normalized name. Invocation
 * always resolves a requested name through that catalog; it never accepts a
 * client-provided path.
 *
 * @module provider/Drivers/CursorSkills
 */
import * as NodeOS from "node:os";

import type { ServerProviderSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";

type CursorSkillScope = "system" | "user";

type SkillFrontmatter =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" }
  | { readonly kind: "parsed"; readonly name?: string; readonly description?: string };

type CursorSkillEntry = {
  readonly skill: ServerProviderSkill;
  readonly root: string;
  readonly scope: CursorSkillScope;
};

export type CursorSkillLoadResult =
  | { readonly kind: "loaded"; readonly skill: ServerProviderSkill; readonly contents: string }
  | {
      readonly kind: "unavailable";
      readonly reason: "invalid-name" | "not-found" | "unreadable" | "too-large";
    };

export type CursorAskmodeFallbackLoadResult =
  | { readonly kind: "loaded"; readonly path: string; readonly contents: string }
  | { readonly kind: "unavailable"; readonly reason: "not-found" | "unreadable" | "too-large" };

/**
 * Skill instructions are injected into a provider invocation. Keep each file
 * below 256 KiB so a local skill cannot turn one invocation into an unbounded
 * prompt or memory allocation.
 */
export const CURSOR_SKILL_CONTENT_BYTE_LIMIT = 256 * 1024;

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SKILL_FILE_NAME = "SKILL.md";

function parseSkillFrontmatter(contents: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) {
    return { kind: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return { kind: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "malformed" };
  }

  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  return {
    kind: "parsed",
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

function normalizeSkillName(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0")
  ) {
    return null;
  }
  return normalized;
}

function isWithinRoot(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveUserProfile(environment: NodeJS.ProcessEnv): string {
  return environment.USERPROFILE?.trim() || NodeOS.homedir();
}

function cursorSkillRoots(
  path: Path.Path,
  environment: NodeJS.ProcessEnv,
): ReadonlyArray<{ readonly directory: string; readonly scope: CursorSkillScope }> {
  const userProfile = resolveUserProfile(environment);
  return [
    { directory: path.join(userProfile, ".cursor", "skills-cursor"), scope: "system" },
    { directory: path.join(userProfile, ".cursor", "skills"), scope: "user" },
  ];
}

function skillMetadata(input: {
  readonly contents: string;
  readonly path: string;
  readonly scope: CursorSkillScope;
  readonly fallbackName: string;
}): ServerProviderSkill | null {
  const frontmatter = parseSkillFrontmatter(input.contents);
  if (frontmatter.kind === "malformed") {
    return null;
  }

  // A directory name is Cursor's conventional fallback only when the file has
  // no frontmatter at all. A frontmatter block without a usable name is not a
  // valid catalog entry and must not silently masquerade as a different skill.
  const name = frontmatter.kind === "missing" ? input.fallbackName.trim() : frontmatter.name;
  if (!name || !normalizeSkillName(name)) {
    return null;
  }

  return {
    name,
    path: input.path,
    enabled: true,
    scope: input.scope,
    ...(frontmatter.kind === "parsed" && frontmatter.description
      ? { description: frontmatter.description }
      : {}),
  };
}

type BoundedFileRead =
  | { readonly kind: "contents"; readonly contents: string }
  | { readonly kind: "unavailable"; readonly reason: "unreadable" | "too-large" };

const readBoundedFile = Effect.fn("CursorSkills.readBoundedFile")(function* (
  filePath: string,
): Effect.fn.Return<BoundedFileRead, never, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fileSystem.open(filePath).pipe(Effect.orElseSucceed((): null => null));
      if (!file) {
        return { kind: "unavailable", reason: "unreadable" } as const;
      }

      const info = yield* file.stat.pipe(Effect.orElseSucceed(() => null));
      if (!info || info.type !== "File") {
        return { kind: "unavailable", reason: "unreadable" } as const;
      }
      if (info.size > FileSystem.Size(CURSOR_SKILL_CONTENT_BYTE_LIMIT)) {
        return { kind: "unavailable", reason: "too-large" } as const;
      }

      // Read one byte beyond the cap. This keeps the bound intact if a file
      // grows after its open-handle stat, instead of trusting a racy pathname
      // stat followed by an unbounded readFileString call.
      const read = yield* file.readAlloc(CURSOR_SKILL_CONTENT_BYTE_LIMIT + 1).pipe(
        Effect.match({
          onFailure: () => ({ kind: "unavailable", reason: "unreadable" }) as const,
          onSuccess: (bytes) => ({ kind: "bytes", bytes }) as const,
        }),
      );
      if (read.kind === "unavailable") {
        return read;
      }
      const bytes = Option.getOrElse(read.bytes, () => new Uint8Array());
      if (bytes.byteLength > CURSOR_SKILL_CONTENT_BYTE_LIMIT) {
        return { kind: "unavailable", reason: "too-large" } as const;
      }

      return { kind: "contents", contents: new TextDecoder().decode(bytes) } as const;
    }),
  );
});

const discoverCursorSkillEntries = Effect.fn("CursorSkills.discoverEntries")(function* (
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ReadonlyArray<CursorSkillEntry>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillsByName = new Map<string, CursorSkillEntry>();

  for (const configuredRoot of cursorSkillRoots(path, environment)) {
    const root = yield* fileSystem
      .realPath(configuredRoot.directory)
      .pipe(Effect.orElseSucceed(() => null));
    if (!root) {
      continue;
    }
    const rootInfo = yield* fileSystem.stat(root).pipe(Effect.orElseSucceed(() => null));
    if (!rootInfo || rootInfo.type !== "Directory") {
      continue;
    }

    const directories = [root];
    const visitedDirectories = new Set([root]);
    while (directories.length > 0) {
      const directory = directories.pop();
      if (!directory) continue;
      const entries = yield* fileSystem
        .readDirectory(directory)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

      for (const entry of [...entries].sort()) {
        const candidate = path.join(directory, entry);
        const canonicalCandidate = yield* fileSystem
          .realPath(candidate)
          .pipe(Effect.orElseSucceed(() => null));
        if (!canonicalCandidate || !isWithinRoot(path, root, canonicalCandidate)) {
          continue;
        }
        const info = yield* fileSystem
          .stat(canonicalCandidate)
          .pipe(Effect.orElseSucceed(() => null));
        if (!info) {
          continue;
        }
        if (info.type === "Directory") {
          if (!visitedDirectories.has(canonicalCandidate)) {
            visitedDirectories.add(canonicalCandidate);
            directories.push(canonicalCandidate);
          }
          continue;
        }
        if (info.type !== "File" || path.basename(entry) !== SKILL_FILE_NAME) {
          continue;
        }
        // Cursor skills are directories containing SKILL.md. A SKILL.md at
        // the root itself has no skill-directory parent to use as the
        // convention-based fallback name, so it is not a catalog entry.
        if (path.dirname(path.relative(root, canonicalCandidate)) === ".") {
          continue;
        }

        const read = yield* readBoundedFile(canonicalCandidate);
        if (read.kind !== "contents") {
          continue;
        }
        const skill = skillMetadata({
          contents: read.contents,
          path: canonicalCandidate,
          scope: configuredRoot.scope,
          fallbackName: path.basename(path.dirname(canonicalCandidate)),
        });
        if (!skill) {
          continue;
        }
        const normalizedName = normalizeSkillName(skill.name);
        if (!normalizedName) {
          continue;
        }
        skillsByName.set(normalizedName, { skill, root, scope: configuredRoot.scope });
      }
    }
  }

  return [...skillsByName.values()].sort((left, right) =>
    left.skill.name.localeCompare(right.skill.name),
  );
});

/**
 * Discover Cursor's local skills. `%USERPROFILE%/.cursor/skills` is processed
 * after `skills-cursor`, so personal entries override system entries that have
 * the same trimmed, case-insensitive name.
 */
export const discoverCursorSkills = Effect.fn("discoverCursorSkills")(function* (
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const entries = yield* discoverCursorSkillEntries(environment ?? process.env);
  return entries.map((entry) => entry.skill);
});

/**
 * Load a currently-discoverable Cursor skill by name. The name is only a key
 * into the current catalog; no client value is ever used as a filesystem path.
 */
export const loadCursorSkillByName = Effect.fn("loadCursorSkillByName")(function* (
  name: string,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<CursorSkillLoadResult, never, FileSystem.FileSystem | Path.Path> {
  const normalizedName = normalizeSkillName(name);
  if (!normalizedName) {
    return { kind: "unavailable", reason: "invalid-name" };
  }

  const entries = yield* discoverCursorSkillEntries(environment ?? process.env);
  const entry = entries.find(
    (candidate) => normalizeSkillName(candidate.skill.name) === normalizedName,
  );
  if (!entry) {
    return { kind: "unavailable", reason: "not-found" };
  }

  const path = yield* Path.Path;
  const canonicalPath = yield* (yield* FileSystem.FileSystem)
    .realPath(entry.skill.path)
    .pipe(Effect.orElseSucceed(() => null));
  if (!canonicalPath || !isWithinRoot(path, entry.root, canonicalPath)) {
    return { kind: "unavailable", reason: "unreadable" };
  }
  const read = yield* readBoundedFile(canonicalPath);
  if (read.kind !== "contents") {
    return read;
  }

  const skill = skillMetadata({
    contents: read.contents,
    path: canonicalPath,
    scope: entry.scope,
    fallbackName: path.basename(path.dirname(canonicalPath)),
  });
  if (!skill || normalizeSkillName(skill.name) !== normalizedName) {
    return { kind: "unavailable", reason: "not-found" };
  }
  return { kind: "loaded", skill, contents: read.contents };
});

/**
 * Load only the Codex askmode fallback Cursor is allowed to inject. This is a
 * fixed path, not a Codex skill catalog or a general Codex file reader.
 */
export const loadCursorAskmodeFallback = Effect.fn("loadCursorAskmodeFallback")(function* (
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<CursorAskmodeFallbackLoadResult, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const userProfile = resolveUserProfile(environment ?? process.env);
  const fallbackDirectory = path.join(userProfile, ".codex", "skills", "askmode");
  const fallbackPath = path.join(fallbackDirectory, SKILL_FILE_NAME);
  const root = yield* fileSystem.realPath(fallbackDirectory).pipe(Effect.orElseSucceed(() => null));
  const canonicalPath = yield* fileSystem
    .realPath(fallbackPath)
    .pipe(Effect.orElseSucceed(() => null));
  if (!root || !canonicalPath || !isWithinRoot(path, root, canonicalPath)) {
    return { kind: "unavailable", reason: "not-found" };
  }

  const read = yield* readBoundedFile(canonicalPath);
  return read.kind === "contents"
    ? { kind: "loaded", path: canonicalPath, contents: read.contents }
    : read;
});
