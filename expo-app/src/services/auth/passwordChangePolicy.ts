export const passwordChangePolicy = {
  minimumNewPasswordCharacters: 6,
  successNavigationDelayMilliseconds: 650,
  contentHorizontalPadding: 16,
  contentTopPadding: 20,
  contentBottomPadding: 30,
  contentSpacing: 16,
  rowSpacing: 12,
  rowVerticalPadding: 5,
  fieldSpacing: 6,
  titleFontSize: 14,
  inputFontSize: 15,
  visibilityButtonSize: 36,
  visibilitySymbolSize: 16,
  submitMinimumHeight: 50,
  submitSpacing: 8,
  submitRadius: 16,
  submitFontSize: 16,
} as const;

type Translate = (key: string, ...args: (string | number)[]) => string;

export function passwordSegments(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      (item) => item.segment,
    );
  }
  return Array.from(value);
}

export function passwordChangeValidationMessage(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
  t: Translate,
): string | null {
  if (!currentPassword) return t("password.validation.currentRequired");
  if (passwordSegments(newPassword).length < passwordChangePolicy.minimumNewPasswordCharacters) {
    return t("password.validation.tooShort");
  }
  if (newPassword === currentPassword) return t("password.validation.sameAsCurrent");
  if (confirmPassword !== newPassword) return t("password.validation.confirmMismatch");
  return null;
}
