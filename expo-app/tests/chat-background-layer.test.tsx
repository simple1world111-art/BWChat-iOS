import { render } from "@testing-library/react-native";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import {
  ChatBackgroundLayer,
  chatBackgroundAppearance,
} from "@/components/chat/ChatBackgroundLayer";
import type { ChatBackground } from "@/services/chat-appearance/ChatAppearanceService";

jest.mock("@/components/AuthenticatedImage", () => ({
  AuthenticatedImage: jest.fn(() => null),
}));

describe("native chat background rendering", () => {
  const background: ChatBackground = {
    target_type: "global",
    target_id: "global",
    image_url: "backgrounds/global.jpg",
    updated_at: "v2",
  };

  beforeEach(() => jest.clearAllMocks());

  it("locks the original saturation, contrast, brightness and white wash", () => {
    expect(chatBackgroundAppearance).toEqual({
      saturation: 0.62,
      contrast: 0.82,
      brightness: 1.03,
      whiteOverlayOpacity: 0.46,
    });
  });

  it("uses authenticated media plus the versioned cache identity", async () => {
    await render(<ChatBackgroundLayer background={background} />);

    expect(AuthenticatedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: "http://localhost:8000/api/v1/backgrounds/global.jpg",
        sourceCacheKey: "/api/v1/backgrounds/global.jpg?bg_updated_at=v2",
        contentFit: "cover",
        transition: 0,
      }),
      undefined,
    );
  });

  it("does not request an image for the original default gray background", async () => {
    await render(<ChatBackgroundLayer background={null} />);
    expect(AuthenticatedImage).not.toHaveBeenCalled();
  });
});
