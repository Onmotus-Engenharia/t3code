import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  CURSOR_SKILL_CONTENT_BYTE_LIMIT,
  discoverCursorSkills,
  loadCursorAskmodeFallback,
  loadCursorSkillByName,
} from "./CursorSkills.ts";

const writeFile = Effect.fn(function* (filePath: string, contents: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fileSystem.writeFileString(filePath, contents);
});

const skillPath = (path: Path.Path, root: string, ...directories: ReadonlyArray<string>) =>
  path.join(root, ...directories, "SKILL.md");

it.layer(NodeServices.layer)("CursorSkills", (it) => {
  it.effect("discovers nested skills and lets personal skills override system skills", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const userProfile = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cursor-skills-",
      });
      const systemRoot = path.join(userProfile, ".cursor", "skills-cursor");
      const personalRoot = path.join(userProfile, ".cursor", "skills");

      yield* writeFile(
        skillPath(path, systemRoot, "nested", "review"),
        ["---", "name: Review", "description: System review.", "---", "", "# System"].join("\n"),
      );
      yield* writeFile(skillPath(path, systemRoot, "fallback-name"), "# No frontmatter\n");
      yield* writeFile(
        skillPath(path, systemRoot, "missing-name"),
        "---\ndescription: Not enough.\n---\n",
      );
      yield* writeFile(skillPath(path, systemRoot, "broken"), "---\nname: [broken\n---\n");
      yield* writeFile(path.join(systemRoot, "SKILL.md"), "# Root files are not skills\n");
      yield* writeFile(
        skillPath(path, systemRoot, "oversized"),
        "x".repeat(CURSOR_SKILL_CONTENT_BYTE_LIMIT + 1),
      );
      yield* writeFile(
        skillPath(path, personalRoot, "review"),
        ["---", "name: review", "description: Personal review.", "---", "", "# Personal"].join(
          "\n",
        ),
      );

      const skills = yield* discoverCursorSkills({ USERPROFILE: userProfile });

      assert.deepEqual(skills, [
        {
          name: "fallback-name",
          path: skillPath(path, systemRoot, "fallback-name"),
          enabled: true,
          scope: "system",
        },
        {
          name: "review",
          path: skillPath(path, personalRoot, "review"),
          enabled: true,
          scope: "user",
          description: "Personal review.",
        },
      ]);
    }),
  );

  it.effect("loads an allowlisted skill by normalized name without treating it as a path", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const userProfile = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cursor-skills-",
      });
      const skillContents = [
        "---",
        "name: current-skill",
        "description: Current.",
        "---",
        "",
        "# Current",
      ].join("\n");
      yield* writeFile(
        skillPath(path, path.join(userProfile, ".cursor", "skills"), "current-skill"),
        skillContents,
      );
      const outsidePath = path.join(userProfile, "outside", "SKILL.md");
      yield* writeFile(outsidePath, "private contents");

      const loaded = yield* loadCursorSkillByName(" CURRENT-SKILL ", { USERPROFILE: userProfile });
      assert.deepEqual(loaded, {
        kind: "loaded",
        skill: {
          name: "current-skill",
          path: skillPath(path, path.join(userProfile, ".cursor", "skills"), "current-skill"),
          enabled: true,
          scope: "user",
          description: "Current.",
        },
        contents: skillContents,
      });

      assert.deepEqual(
        yield* loadCursorSkillByName("../../outside/SKILL.md", { USERPROFILE: userProfile }),
        {
          kind: "unavailable",
          reason: "invalid-name",
        },
      );
    }),
  );

  it.effect(
    "returns structured unavailable results for the fixed askmode fallback and enforces its cap",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const userProfile = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-cursor-skills-",
        });
        const fallbackPath = path.join(userProfile, ".codex", "skills", "askmode", "SKILL.md");
        const fallbackContents = "# Ask mode\n";

        assert.deepEqual(yield* loadCursorAskmodeFallback({ USERPROFILE: userProfile }), {
          kind: "unavailable",
          reason: "not-found",
        });

        yield* writeFile(fallbackPath, fallbackContents);
        assert.deepEqual(yield* loadCursorAskmodeFallback({ USERPROFILE: userProfile }), {
          kind: "loaded",
          path: fallbackPath,
          contents: fallbackContents,
        });

        yield* fileSystem.writeFileString(
          fallbackPath,
          "x".repeat(CURSOR_SKILL_CONTENT_BYTE_LIMIT + 1),
        );
        assert.deepEqual(yield* loadCursorAskmodeFallback({ USERPROFILE: userProfile }), {
          kind: "unavailable",
          reason: "too-large",
        });
      }),
  );
});
