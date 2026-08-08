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

const parsed = publicConfigSchema.safeParse(Constants.expoConfig?.extra);

if (!parsed.success) {
  throw new Error(`Invalid Expo public configuration: ${parsed.error.message}`);
}

export const env = parsed.data;
export type AppEnvironment = z.infer<typeof environmentSchema>;
