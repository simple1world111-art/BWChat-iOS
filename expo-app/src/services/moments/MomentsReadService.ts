import { markMomentsNotificationsRead } from "@/api/bwchat";
import { dismissReadMomentsNotifications } from "@/services/push/PushService";

export async function markMomentsNotificationsReadEverywhere(): Promise<void> {
  await markMomentsNotificationsRead();
  await dismissReadMomentsNotifications();
}
