// @effect-diagnostics nodeBuiltinImport:off - Validates tracked build-tool assets.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { PNG } from "pngjs";

import { encodePngIcns, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";
import {
  decodePngIco,
  generateOrchestratorIconAssets,
  parseOrchestratorFill,
  tintGrayscalePng,
} from "./generate-orchestrator-icons.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => NodeFS.readFileSync(NodePath.join(repoRoot, relativePath));

describe("orchestrator icon generator", () => {
  it("parses the Icon Composer indigo fill as the raster color source", () => {
    assert.deepEqual(
      parseOrchestratorFill(read("assets/orchestrator/app-icon.icon/icon.json").toString("utf8")),
      { red: 45, green: 35, blue: 89 },
    );
  });

  it("tints grayscale geometry while preserving alpha and the white mark", () => {
    const source = new PNG({ width: 2, height: 1 });
    source.data.set([0, 0, 0, 127, 255, 255, 255, 255]);
    const result = PNG.sync.read(
      tintGrayscalePng(PNG.sync.write(source), { red: 45, green: 35, blue: 89 }),
    );

    assert.deepEqual(Array.from(result.data), [45, 35, 89, 127, 255, 255, 255, 255]);
  });

  it("keeps every production ICO rendition and matches all tracked generated assets", () => {
    const outputs = generateOrchestratorIconAssets({
      iconJson: read("assets/orchestrator/app-icon.icon/icon.json").toString("utf8"),
      macTemplate: read("assets/prod/black-macos-1024.png"),
      universalTemplate: read("assets/prod/black-universal-1024.png"),
      windowsTemplate: read("assets/prod/t3-black-windows.ico"),
    });

    assert.deepEqual(
      decodePngIco(outputs.windows).map((rendition) => rendition.size),
      [...WINDOWS_ICON_SIZES],
    );
    assert.isTrue(outputs.mac.equals(read("assets/orchestrator/orchestrator-macos-1024.png")));
    assert.isTrue(
      outputs.universal.equals(read("assets/orchestrator/orchestrator-universal-1024.png")),
    );
    assert.isTrue(outputs.windows.equals(read("assets/orchestrator/orchestrator-windows.ico")));
  });

  it("encodes standard PNG ICNS chunks without relying on iconutil", () => {
    const source = new PNG({ width: 16, height: 16 });
    const png = PNG.sync.write(source);
    const encoded = encodePngIcns([
      { type: "ic04", contents: png },
      { type: "ic11", contents: png },
    ]);

    assert.equal(encoded.toString("ascii", 0, 4), "icns");
    assert.equal(encoded.readUInt32BE(4), encoded.length);
    assert.equal(encoded.toString("ascii", 8, 12), "ic04");
    const secondChunkOffset = 8 + encoded.readUInt32BE(12);
    assert.equal(encoded.toString("ascii", secondChunkOffset, secondChunkOffset + 4), "ic11");
  });
});
