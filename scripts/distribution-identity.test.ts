// @effect-diagnostics nodeBuiltinImport:off - Verifies both platform path implementations.

import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import desktopPackageJson from "../apps/desktop/package.json" with { type: "json" };
import serverPackageJson from "../apps/server/package.json" with { type: "json" };
import webPackageJson from "../apps/web/package.json" with { type: "json" };
import distribution from "../distribution.json" with { type: "json" };
import contractsPackageJson from "../packages/contracts/package.json" with { type: "json" };
import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

const ORCHESTRATOR_RELEASE_VERSION = "0.0.37-orchestrator.1";

describe("custom distribution identity", () => {
  it("keeps install, runtime, protocol, and package identities visibly separate from upstream", () => {
    assert.equal(distribution.displayName, "T3 Code Orchestrator");
    assert.equal(distribution.slug, "t3-code-orchestrator");
    assert.equal(distribution.appId, "dev.mateuslucas.t3code.orchestrator");
    assert.equal(distribution.appUserModelId, distribution.appId);
    assert.equal(desktopPackageJson.productName, distribution.displayName);
    assert.notEqual(distribution.directories.userData, "t3code");
    assert.notEqual(distribution.directories.base, ".t3");
    assert.notEqual(distribution.protocols.production, "t3code");
    assert.notEqual(distribution.backend.defaultPort, 3773);
    assert.equal(
      distribution.backend.corsOrigin,
      `${distribution.protocols.production}://${distribution.protocols.host}`,
    );
  });

  it("uses platform-native separators for isolated runtime directories", () => {
    const relativeSegments = [
      distribution.directories.state,
      distribution.directories.cache,
      distribution.directories.logs,
      distribution.directories.locks,
    ];

    for (const segment of relativeSegments) {
      assert.equal(
        NodePath.posix.join("/home/alice", distribution.directories.base, segment),
        `/home/alice/${distribution.directories.base}/${segment}`,
      );
      assert.equal(
        NodePath.win32.join("C:\\Users\\alice", distribution.directories.base, segment),
        `C:\\Users\\alice\\${distribution.directories.base}\\${segment}`,
      );
    }
  });

  it("hard-disables upstream update feeds and points at the custom icon source", () => {
    assert.isFalse(distribution.updater.enabled);
    assert.include(distribution.updater.reason, "custom distribution");
    assert.include(distribution.updater.reason, "no verified fork update feed");
    assert.equal(
      BRAND_ASSET_PATHS.orchestratorIconComposerProject,
      distribution.iconComposerProject,
    );
    assert.notEqual(
      BRAND_ASSET_PATHS.orchestratorIconComposerProject,
      BRAND_ASSET_PATHS.productionIconComposerProject,
    );
  });
  it("keeps every desktop-distributed package on the current Orchestrator release", () => {
    assert.equal(desktopPackageJson.version, ORCHESTRATOR_RELEASE_VERSION);
    assert.equal(serverPackageJson.version, ORCHESTRATOR_RELEASE_VERSION);
    assert.equal(webPackageJson.version, ORCHESTRATOR_RELEASE_VERSION);
    assert.equal(contractsPackageJson.version, ORCHESTRATOR_RELEASE_VERSION);
  });
});
