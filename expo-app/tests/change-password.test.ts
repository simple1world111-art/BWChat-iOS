import { changePassword } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  passwordChangePolicy,
  passwordChangeValidationMessage,
  passwordSegments,
} from "@/services/auth/passwordChangePolicy";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, apiRequest: jest.fn() };
});

const request = jest.mocked(apiRequest);
const t = (key: string) => key;

describe("native ChangePasswordView policy and API", () => {
  beforeEach(() => request.mockReset());

  it("locks the original layout, validation and success-delay constants", () => {
    expect(passwordChangePolicy).toEqual({
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
    });
  });

  it("matches Swift Character counting and validation precedence", () => {
    expect(passwordSegments("👨‍👩‍👧‍👦e\u0301")).toHaveLength(2);
    expect(passwordChangeValidationMessage("", "", "", t)).toBe(
      "password.validation.currentRequired",
    );
    expect(passwordChangeValidationMessage("old", "12345", "12345", t)).toBe(
      "password.validation.tooShort",
    );
    expect(passwordChangeValidationMessage("same12", "same12", "same12", t)).toBe(
      "password.validation.sameAsCurrent",
    );
    expect(passwordChangeValidationMessage("old123", "new123", "different", t)).toBe(
      "password.validation.confirmMismatch",
    );
    expect(passwordChangeValidationMessage("old123", "new123", "new123", t)).toBeNull();
  });

  it("uses the exact POST body and requires the native EmptyData envelope", async () => {
    request.mockResolvedValueOnce(undefined);
    await expect(changePassword("old123", "new123")).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("/auth/change-password", {
      method: "POST",
      body: { old_password: "old123", new_password: "new123" },
      requiredEnvelope: true,
    });
  });
});
