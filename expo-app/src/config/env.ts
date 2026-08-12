import Constants from "expo-constants";
import { z } from "zod";

const environmentSchema = z.enum(["development", "preview", "production"]);

const publicConfigSchema = z.object({
  environment: environmentSchema,
  apiBaseUrl: z.string().url(),
  webBaseUrl: z.string().url(),
  webSocketUrl: z.string().url(),
  remoteConfigUrl: z.string().url(),
  sentryDsn: z.string().url().optional(),
});

export const securePublicEndpoints = {
  apiBaseUrl: "https://id7.com/api/v1",
  webBaseUrl: "https://id7.com",
  webSocketUrl: "wss://id7.com/ws",
  remoteConfigUrl: "https://id7.com/api/v1/app/config",
  liveKitUrl: "wss://id7.com/livekit",
} as const;

const parsed = publicConfigSchema.safeParse(Constants.expoConfig?.extra);

if (!parsed.success) {
  throw new Error(`Invalid Expo public configuration: ${parsed.error.message}`);
}

export const env =
  parsed.data.environment === "development"
    ? { ...parsed.data, liveKitUrl: securePublicEndpoints.liveKitUrl }
    : { ...parsed.data, ...securePublicEndpoints };
export type AppEnvironment = z.infer<typeof environmentSchema>;
