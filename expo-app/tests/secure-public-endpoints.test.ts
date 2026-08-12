describe("OTA secure public endpoints", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("expo-constants");
  });

  it.each(["preview", "production"] as const)(
    "forces %s traffic to id7.com even when the native shell contains legacy values",
    (environment) => {
      let loaded:
        | {
            env: Record<string, string>;
            securePublicEndpoints: Record<string, string>;
          }
        | undefined;
      jest.isolateModules(() => {
        jest.doMock("expo-constants", () => ({
          __esModule: true,
          default: {
            expoConfig: {
              extra: {
                environment,
                apiBaseUrl: "http://192.0.2.8:8001/api/v1",
                webBaseUrl: "http://192.0.2.8:8001",
                webSocketUrl: "ws://192.0.2.8:8001/ws",
                remoteConfigUrl: "http://192.0.2.8:8001/api/v1/app/config",
              },
            },
          },
        }));
        loaded = jest.requireActual("@/config/env") as typeof loaded;
      });

      expect(loaded?.env).toMatchObject({
        apiBaseUrl: "https://id7.com/api/v1",
        webBaseUrl: "https://id7.com",
        webSocketUrl: "wss://id7.com/ws",
        remoteConfigUrl: "https://id7.com/api/v1/app/config",
        liveKitUrl: "wss://id7.com/livekit",
      });
      expect(Object.values(loaded?.securePublicEndpoints ?? {})).not.toEqual(
        expect.arrayContaining([expect.stringContaining("192.0.2.8")]),
      );
    },
  );

  it("keeps development endpoints configurable while retaining the secure LiveKit fallback", () => {
    let loaded: { env: Record<string, string> } | undefined;
    jest.isolateModules(() => {
      jest.doMock("expo-constants", () => ({
        __esModule: true,
        default: {
          expoConfig: {
            extra: {
              environment: "development",
              apiBaseUrl: "http://localhost:8001/api/v1",
              webBaseUrl: "http://localhost:8001",
              webSocketUrl: "ws://localhost:8001/ws",
              remoteConfigUrl: "http://localhost:8001/api/v1/app/config",
            },
          },
        },
      }));
      loaded = jest.requireActual("@/config/env") as typeof loaded;
    });
    expect(loaded?.env).toMatchObject({
      apiBaseUrl: "http://localhost:8001/api/v1",
      webSocketUrl: "ws://localhost:8001/ws",
      liveKitUrl: "wss://id7.com/livekit",
    });
  });
});
