import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getNextEffortUpdate, getNextFavoriteModel } from "./composerModelCycling";

const PROVIDER = ProviderDriverKind.make("codex");
const MODEL = "test-model";

function selectDescriptor(
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  promptInjectedValues?: ReadonlyArray<string>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const currentValue = options.find((option) => option.isDefault)?.id;
  return {
    id: "effort",
    label: "Effort",
    type: "select",
    options: [...options],
    ...(currentValue ? { currentValue } : {}),
    ...(promptInjectedValues ? { promptInjectedValues: [...promptInjectedValues] } : {}),
  };
}

function modelsWith(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    {
      slug: MODEL,
      name: MODEL,
      isCustom: false,
      capabilities: { optionDescriptors: descriptors },
    },
  ];
}

function selections(
  ...entries: Array<[string, string | boolean]>
): ReadonlyArray<ProviderOptionSelection> {
  return entries.map(([id, value]) => ({ id, value }));
}

describe("getNextFavoriteModel", () => {
  const codex = ProviderInstanceId.make("codex");
  const claude = ProviderInstanceId.make("claudeAgent");
  const favorites = [
    { instanceId: codex, model: "gpt-5.6-sol" },
    { instanceId: codex, model: "gpt-5.6-terra" },
    { instanceId: claude, model: "claude-opus" },
  ];

  it("selects the first favorite when the current model is not a favorite", () => {
    expect(getNextFavoriteModel({ instanceId: codex, model: "gpt-5.5" }, favorites)).toEqual(
      favorites[0],
    );
  });

  it("advances through favorites and wraps", () => {
    expect(getNextFavoriteModel(favorites[0]!, favorites)).toEqual(favorites[1]);
    expect(getNextFavoriteModel(favorites[2]!, favorites)).toEqual(favorites[0]);
  });

  it("returns null when cycling cannot change the model", () => {
    expect(getNextFavoriteModel(favorites[0]!, [favorites[0]!])).toBeNull();
    expect(getNextFavoriteModel(favorites[0]!, [])).toBeNull();
  });
});

describe("getNextEffortUpdate", () => {
  const effortModels = modelsWith([
    selectDescriptor([
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High", isDefault: true },
    ]),
    { id: "fastMode", label: "Fast", type: "boolean" },
  ]);

  it("cycles in provider order, wraps, and preserves other options", () => {
    expect(
      getNextEffortUpdate({
        provider: PROVIDER,
        model: MODEL,
        models: effortModels,
        modelOptions: selections(["effort", "low"], ["fastMode", true]),
        prompt: "",
        planModeEnabled: true,
      }),
    ).toEqual({
      modelOptions: selections(["effort", "medium"], ["fastMode", true]),
    });

    expect(
      getNextEffortUpdate({
        provider: PROVIDER,
        model: MODEL,
        models: effortModels,
        modelOptions: selections(["effort", "high"]),
        prompt: "",
        planModeEnabled: true,
      }),
    ).toEqual({ modelOptions: selections(["effort", "low"]) });
  });

  it("uses the same prompt-controlled ultrathink behavior as the traits picker", () => {
    const models = modelsWith([
      selectDescriptor(
        [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
          { id: "ultrathink", label: "Ultrathink" },
        ],
        ["ultrathink"],
      ),
    ]);

    expect(
      getNextEffortUpdate({
        provider: PROVIDER,
        model: MODEL,
        models,
        modelOptions: selections(["effort", "high"]),
        prompt: "Investigate",
        planModeEnabled: true,
      }),
    ).toEqual({ prompt: "Ultrathink:\nInvestigate" });

    expect(
      getNextEffortUpdate({
        provider: PROVIDER,
        model: MODEL,
        models,
        modelOptions: selections(["effort", "high"]),
        prompt: "Ultrathink:\nInvestigate",
        planModeEnabled: true,
      }),
    ).toEqual({
      prompt: "Investigate",
      modelOptions: selections(["effort", "low"]),
    });
  });

  it("is a no-op when effort is unsupported or ultrathink appears in prompt body text", () => {
    expect(
      getNextEffortUpdate({
        provider: PROVIDER,
        model: MODEL,
        models: modelsWith([]),
        modelOptions: undefined,
        prompt: "",
        planModeEnabled: true,
      }),
    ).toBeNull();

    expect(
      getNextEffortUpdate({
        provider: PROVIDER,
        model: MODEL,
        models: modelsWith([
          {
            id: "agent",
            label: "Agent",
            type: "select",
            options: [
              { id: "build", label: "Build", isDefault: true },
              { id: "plan", label: "Plan" },
            ],
            currentValue: "build",
          },
        ]),
        modelOptions: undefined,
        prompt: "",
        planModeEnabled: true,
      }),
    ).toBeNull();

    expect(
      getNextEffortUpdate({
        provider: PROVIDER,
        model: MODEL,
        models: modelsWith([
          selectDescriptor(
            [
              { id: "low", label: "Low" },
              { id: "ultrathink", label: "Ultrathink", isDefault: true },
            ],
            ["ultrathink"],
          ),
        ]),
        modelOptions: undefined,
        prompt: "Explain the word ultrathink in this text",
        planModeEnabled: true,
      }),
    ).toBeNull();
  });
});
