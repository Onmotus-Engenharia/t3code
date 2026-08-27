import type {
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
  SelectableMarkdownTextProps,
} from "@t3tools/mobile-markdown-text/types";

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
  return false;
}

export function SelectableMarkdownText(_props: MobileSelectableMarkdownTextProps) {
  return null;
}
