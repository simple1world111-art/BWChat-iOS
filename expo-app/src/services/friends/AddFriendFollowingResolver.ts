import { getFollowing } from "@/api/bwchat";
import type { FollowUser } from "@/models";

const pageSize = 50;
const maximumPages = 10;

export async function loadCurrentFollowingForSearch(): Promise<FollowUser[]> {
  const users: FollowUser[] = [];
  const seenUserIds = new Set<string>();
  let page = 1;

  for (let requestCount = 0; requestCount < maximumPages; requestCount += 1) {
    const result = await getFollowing({ page, limit: pageSize });
    for (const user of result.users) {
      if (seenUserIds.has(user.user_id)) continue;
      seenUserIds.add(user.user_id);
      users.push({ ...user, followed_by_me: true });
    }
    if (!result.has_more) break;
    const nextPage = result.next_page ?? page + 1;
    if (nextPage <= page) break;
    page = nextPage;
  }

  return users;
}
