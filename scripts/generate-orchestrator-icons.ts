// @effect-diagnostics nodeBuiltinImport:off globalProcess:off - Deterministic tracked asset generator.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { PNG } from "pngjs";

import { encodePngIco, type PngIconImage } from "./lib/icon-export.ts";

const DISPLAY_P3_FILL_PATTERN =
  /^display-p3:(?<red>\d+(?:\.\d+)?),(?<green>\d+(?:\.\d+)?),(?<blue>\d+(?:\.\d+)?),(?<alpha>\d+(?:\.\d+)?)$/u;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WHITE_MARK_THRESHOLD = 245;

export interface OrchestratorRgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface OrchestratorIconInputs {
  readonly iconJson: string;
  readonly macTemplate: Buffer;
  readonly universalTemplate: Buffer;
  readonly windowsTemplate: Buffer;
}

export interface OrchestratorIconOutputs {
  readonly mac: Buffer;
  readonly universal: Buffer;
  readonly windows: Buffer;
}

const normalizedChannel = (value: string): number => {
  const channel = Number(value);
  if (!Number.isFinite(channel) || channel < 0 || channel > 1) {
    throw new Error("The orchestrator Icon Composer fill must use channels from 0 through 1.");
  }
  return Math.round(channel * 255);
};

export function parseOrchestratorFill(iconJson: string): OrchestratorRgb {
  const parsed = JSON.parse(iconJson) as { fill?: { solid?: unknown } };
  if (typeof parsed.fill?.solid !== "string") {
    throw new Error("The orchestrator Icon Composer source is missing its solid fill.");
  }

  const match = DISPLAY_P3_FILL_PATTERN.exec(parsed.fill.solid);
  if (!match?.groups) {
    throw new Error("The orchestrator Icon Composer fill is not a supported display-p3 color.");
  }
  const { red, green, blue, alpha } = match.groups;
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined) {
    throw new Error("The orchestrator Icon Composer fill is missing a color channel.");
  }
  if (normalizedChannel(alpha) !== 255) {
    throw new Error("The orchestrator Icon Composer fill must be fully opaque.");
  }

  return {
    red: normalizedChannel(red),
    green: normalizedChannel(green),
    blue: normalizedChannel(blue),
  };
}

const tintChannel = (fillChannel: number, luminance: number): number =>
  Math.round(fillChannel + ((255 - fillChannel) * luminance) / 255);

export function tintGrayscalePng(template: Buffer, fill: OrchestratorRgb): Buffer {
  const source = PNG.sync.read(template);
  const tinted = new PNG({ width: source.width, height: source.height });

  for (let offset = 0; offset < source.data.length; offset += 4) {
    const red = source.data[offset] ?? 0;
    const green = source.data[offset + 1] ?? 0;
    const blue = source.data[offset + 2] ?? 0;
    const alpha = source.data[offset + 3] ?? 0;

    if (
      alpha === 0 ||
      (red >= WHITE_MARK_THRESHOLD && green >= WHITE_MARK_THRESHOLD && blue >= WHITE_MARK_THRESHOLD)
    ) {
      tinted.data[offset] = red;
      tinted.data[offset + 1] = green;
      tinted.data[offset + 2] = blue;
      tinted.data[offset + 3] = alpha;
      continue;
    }

    const luminance = Math.round((red + green + blue) / 3);
    tinted.data[offset] = tintChannel(fill.red, luminance);
    tinted.data[offset + 1] = tintChannel(fill.green, luminance);
    tinted.data[offset + 2] = tintChannel(fill.blue, luminance);
    tinted.data[offset + 3] = alpha;
  }

  return PNG.sync.write(tinted, {
    bitDepth: 8,
    colorType: 6,
    inputColorType: 6,
    deflateLevel: 9,
    deflateStrategy: 3,
  });
}

export function decodePngIco(contents: Buffer): ReadonlyArray<PngIconImage> {
  if (contents.length < 6 || contents.readUInt16LE(0) !== 0 || contents.readUInt16LE(2) !== 1) {
    throw new Error("The production Windows geometry template is not an ICO file.");
  }

  const count = contents.readUInt16LE(4);
  const directoryEnd = 6 + count * 16;
  if (count === 0 || directoryEnd > contents.length) {
    throw new Error("The production Windows geometry template has an invalid directory.");
  }

  return Array.from({ length: count }, (_, index) => {
    const entryOffset = 6 + index * 16;
    const width = contents.readUInt8(entryOffset) || 256;
    const height = contents.readUInt8(entryOffset + 1) || 256;
    const byteLength = contents.readUInt32LE(entryOffset + 8);
    const imageOffset = contents.readUInt32LE(entryOffset + 12);
    const imageEnd = imageOffset + byteLength;
    if (
      width !== height ||
      byteLength === 0 ||
      imageOffset < directoryEnd ||
      imageEnd > contents.length
    ) {
      throw new Error("The production Windows geometry template has an invalid rendition.");
    }
    const image = contents.subarray(imageOffset, imageEnd);
    if (!image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error("Every production Windows geometry rendition must be PNG encoded.");
    }
    return { size: width, contents: image };
  });
}

export function generateOrchestratorIconAssets(
  input: OrchestratorIconInputs,
): OrchestratorIconOutputs {
  const fill = parseOrchestratorFill(input.iconJson);
  const windowsRenditions = decodePngIco(input.windowsTemplate).map((rendition) => ({
    size: rendition.size,
    contents: tintGrayscalePng(rendition.contents, fill),
  }));

  return {
    mac: tintGrayscalePng(input.macTemplate, fill),
    universal: tintGrayscalePng(input.universalTemplate, fill),
    windows: encodePngIco(windowsRenditions),
  };
}

function main(): void {
  const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
  const read = (relativePath: string) => NodeFS.readFileSync(NodePath.join(repoRoot, relativePath));
  const outputs = generateOrchestratorIconAssets({
    iconJson: read("assets/orchestrator/app-icon.icon/icon.json").toString("utf8"),
    macTemplate: read("assets/prod/black-macos-1024.png"),
    universalTemplate: read("assets/prod/black-universal-1024.png"),
    windowsTemplate: read("assets/prod/t3-black-windows.ico"),
  });
  const outputDirectory = NodePath.join(repoRoot, "assets", "orchestrator");
  NodeFS.mkdirSync(outputDirectory, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(outputDirectory, "orchestrator-macos-1024.png"), outputs.mac);
  NodeFS.writeFileSync(
    NodePath.join(outputDirectory, "orchestrator-universal-1024.png"),
    outputs.universal,
  );
  NodeFS.writeFileSync(NodePath.join(outputDirectory, "orchestrator-windows.ico"), outputs.windows);
}

if (import.meta.main) {
  main();
}
