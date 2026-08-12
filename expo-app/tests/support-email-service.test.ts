import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking } from "react-native";

import {
  normalizedSupportEmail,
  openSupportEmail,
  persistLastKnownGoodSupportEmail,
  readLastKnownGoodSupportEmail,
  resetSupportEmailMemoryForTests,
  supportMailtoURL,
} from "@/services/account/SupportEmailService";

describe("support email policy", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    await AsyncStorage.clear();
    resetSupportEmailMemoryForTests();
  });

  it("trims and validates a server-provided email", () => {
    expect(normalizedSupportEmail("  Support+privacy@example.com ")).toBe(
      "Support+privacy@example.com",
    );
    expect(normalizedSupportEmail("not-an-email")).toBeUndefined();
  });

  it("keeps the last-known-good value when a later value is missing or invalid", async () => {
    await persistLastKnownGoodSupportEmail("last-good@example.com");
    await persistLastKnownGoodSupportEmail(undefined);
    await persistLastKnownGoodSupportEmail("invalid");
    resetSupportEmailMemoryForTests();

    await expect(readLastKnownGoodSupportEmail()).resolves.toBe("last-good@example.com");
  });

  it("builds and opens an encoded mailto without query parameters", async () => {
    expect(supportMailtoURL("Support+privacy@example.com")).toBe(
      "mailto:Support%2Bprivacy%40example.com",
    );
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await expect(openSupportEmail("Support+privacy@example.com")).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("mailto:Support%2Bprivacy%40example.com");
    expect(open.mock.calls[0]?.[0]).not.toContain("subject=");
    expect(open.mock.calls[0]?.[0]).not.toContain("body=");
  });

  it("does not log the email when the system mail app cannot open", async () => {
    const logs = [
      jest.spyOn(console, "log").mockImplementation(),
      jest.spyOn(console, "warn").mockImplementation(),
      jest.spyOn(console, "error").mockImplementation(),
    ];
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("unavailable"));

    await expect(openSupportEmail("private-support@example.com")).resolves.toBe(false);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
