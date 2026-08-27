import { SelectableMarkdownText as T3SelectableMarkdownText } from "@t3tools/mobile-markdown-text/renderer";
import type {
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
  SelectableMarkdownTextProps,
} from "@t3tools/mobile-markdown-text/types";
import type { ReactNode } from "react";

import { highlightCodeSnippet } from "../features/review/shikiReviewHighlighter";

export interface MarkdownImageRequest {
  readonly href: string;
  readonly alt: string | null;
  readonly title: string | null;
}

export type MarkdownImageRenderer = (image: MarkdownImageRequest) => import("react").ReactNode;

type MobileSelectableMarkdownTextProps = Omit<SelectableMarkdownTextProps, "highlightCode"> & {
  readonly renderImage?: MarkdownImageRenderer;
};

export type { NativeMarkdownTextStyle, SelectableMarkdownSkill };

export function hasNativeSelectableMarkdownText(): boolean {
  return true;
}

export function SelectableMarkdownText(props: MobileSelectableMarkdownTextProps) {
  const NativeSelectableMarkdownText = T3SelectableMarkdownText as unknown as (
    input: SelectableMarkdownTextProps & { readonly renderImage?: MarkdownImageRenderer },
  ) => ReactNode;
  return <NativeSelectableMarkdownText {...props} highlightCode={highlightCodeSnippet} />;
}
