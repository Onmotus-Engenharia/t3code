import type {
  ModelSelection,
  ProviderDriverKind,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@t3tools/contracts";
import {
  applyClaudePromptEffortPrefix,
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@t3tools/shared/model";

import { getProviderModelCapabilities } from "../../providerModels";

export type FavoriteModelTarget = Pick<ModelSelection, "instanceId" | "model">;

const EFFORT_DESCRIPTOR_IDS = new Set(["reasoningEffort", "effort", "reasoning", "variant"]);

export function getNextFavoriteModel(
  current: FavoriteModelTarget,
  favorites: ReadonlyArray<FavoriteModelTarget>,
): FavoriteModelTarget | null {
  if (favorites.length === 0) return null;

  const currentIndex = favorites.findIndex(
    (favorite) => favorite.instanceId === current.instanceId && favorite.model === current.model,
  );
  const next = favorites[currentIndex < 0 ? 0 : (currentIndex + 1) % favorites.length];
  if (!next || (next.instanceId === current.instanceId && next.model === current.model)) {
    return null;
  }
  return next;
}

function replaceDescriptorCurrentValue(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  descriptorId: string,
  currentValue: string,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) =>
    descriptor.id === descriptorId && descriptor.type === "select"
      ? { ...descriptor, currentValue }
      : descriptor,
  );
}

export type NextEffortUpdate = {
  readonly prompt?: string;
  readonly modelOptions?: ReadonlyArray<ProviderOptionSelection>;
};

export function getNextEffortUpdate(input: {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  prompt: string;
  planModeEnabled: boolean;
}): NextEffortUpdate | null {
  const caps = getProviderModelCapabilities(
    input.models,
    input.model,
    input.provider,
    input.planModeEnabled,
  );
  const descriptors = getProviderOptionDescriptors({
    caps,
    selections: input.modelOptions,
  });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select" && EFFORT_DESCRIPTOR_IDS.has(descriptor.id),
  );
  if (!primarySelectDescriptor || primarySelectDescriptor.options.length === 0) {
    return null;
  }

  const promptInjectedValues = primarySelectDescriptor.promptInjectedValues ?? [];
  const promptControlled =
    promptInjectedValues.length > 0 && isClaudeUltrathinkPrompt(input.prompt);
  const promptWithoutPrefix = input.prompt.replace(/^Ultrathink:\s*/i, "");
  if (promptControlled && isClaudeUltrathinkPrompt(promptWithoutPrefix)) {
    return null;
  }

  const currentValue = promptControlled
    ? promptInjectedValues.find((value) =>
        primarySelectDescriptor.options.some((option) => option.id === value),
      )
    : getProviderOptionCurrentValue(primarySelectDescriptor);
  const currentIndex = primarySelectDescriptor.options.findIndex(
    (option) => option.id === currentValue,
  );
  const nextOption =
    primarySelectDescriptor.options[
      currentIndex < 0 ? 0 : (currentIndex + 1) % primarySelectDescriptor.options.length
    ];
  if (!nextOption || nextOption.id === currentValue) {
    return null;
  }

  if (promptInjectedValues.includes(nextOption.id)) {
    const prompt =
      input.prompt.trim().length === 0
        ? "Ultrathink:\n"
        : applyClaudePromptEffortPrefix(input.prompt, "ultrathink");
    return prompt === input.prompt ? null : { prompt };
  }

  const modelOptions = buildProviderOptionSelectionsFromDescriptors(
    replaceDescriptorCurrentValue(descriptors, primarySelectDescriptor.id, nextOption.id),
  );
  return {
    ...(promptControlled ? { prompt: promptWithoutPrefix } : {}),
    ...(modelOptions ? { modelOptions } : {}),
  };
}
