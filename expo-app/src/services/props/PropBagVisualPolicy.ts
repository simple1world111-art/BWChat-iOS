import type { ColorSchemeName } from "react-native";

export const propBagMetrics = {
  horizontalInset: 16,
  topInset: 18,
  bottomInset: 32,
  contentGap: 16,
  gridColumns: 3,
  gridGap: 10,
  artworkSize: 92,
  innerMinimumHeight: 170,
  cardHorizontalInset: 8,
  cardTopInset: 10,
  cardBottomInset: 8,
  cardRadius: 16,
  quantityHeight: 24,
  quantityHorizontalInset: 7,
  primaryStateHeight: 280,
  detailContentGap: 14,
  detailHeaderRadius: 22,
  transactionStateHeight: 220,
  transactionPageSize: 20,
  popoverWidth: 262,
  popoverEdgeInset: 12,
  popoverArrowGap: 10,
  popoverArrowSize: 8,
} as const;

export interface PropBagAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PropBagPopoverPlacement {
  arrowDirection: "up" | "down";
  arrowLeft: number;
  left: number;
  top: number;
  width: number;
}

export function propBagPopoverPlacement(
  anchor: PropBagAnchorRect,
  viewport: { width: number; height: number },
  popoverHeight: number,
): PropBagPopoverPlacement {
  const edge = propBagMetrics.popoverEdgeInset;
  const gap = propBagMetrics.popoverArrowGap;
  const arrowSize = propBagMetrics.popoverArrowSize;
  const width = Math.min(propBagMetrics.popoverWidth, Math.max(0, viewport.width - edge * 2));
  const height = Math.max(1, popoverHeight);
  const anchorCenter = anchor.x + anchor.width / 2;
  const left = clamp(anchorCenter - width / 2, edge, viewport.width - width - edge);
  const belowTop = anchor.y + anchor.height + gap;
  const aboveTop = anchor.y - height - gap;
  const showAbove = belowTop + height > viewport.height - edge && aboveTop >= edge;
  const top = clamp(showAbove ? aboveTop : belowTop, edge, viewport.height - height - edge);
  return {
    arrowDirection: showAbove ? "down" : "up",
    arrowLeft: clamp(anchorCenter - left - arrowSize, edge, width - edge - arrowSize * 2),
    left,
    top,
    width,
  };
}

export function propBagPalette(scheme: ColorSchemeName) {
  const dark = scheme === "dark";
  return {
    background: dark ? "#1C1C1E" : "#F2F2F7",
    card: dark ? "#000000" : "#FFFFFF",
    text: "#1A1A2E",
    secondaryText: "#9E9EB8",
    tertiaryText: "#C4C4D4",
    separator: "#F0F0F5",
    accent: "#667EEA",
    accentSoft: "rgba(102,126,234,0.12)",
    warning: "#FF9500",
  } as const;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}
