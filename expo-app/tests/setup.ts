jest.mock("@react-native-async-storage/async-storage", () =>
  // Jest publishes this official mock as CommonJS only.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        environment: "development",
        apiBaseUrl: "http://localhost:8000/api/v1",
        webBaseUrl: "http://localhost:8000",
        webSocketUrl: "ws://localhost:8000/ws",
        remoteConfigUrl: "http://localhost:8000/api/v1/app/config",
      },
    },
  },
}));
