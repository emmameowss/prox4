// Who is allowed to review confessions.
//
// Membership of the staging channel *is* the moderator list - there is no
// separate allowlist. Lives apart from main.ts for the same reason slack.ts
// does: block_action.ts can import it without dragging in the whole pipeline.

import { web } from "./slack";
import { staging_channel } from "./secrets_wrapper";

// Long enough that a moderator working through the queue doesn't pay an API
// call per button, short enough that channel changes take effect quickly.
const CACHE_TTL_MS = 60 * 1000;
// A miss refetches in case the user joined moments ago, but not if the list
// we have is this fresh - otherwise every click by an outsider costs a fetch.
const MIN_REFETCH_AGE_MS = 5 * 1000;

let cache: { members: Set<string>; fetched_at: number } | null = null;

async function fetchMembers(): Promise<Set<string>> {
  console.log(`Fetching staging channel members...`);
  const members = new Set<string>();
  let cursor: string | undefined = undefined;
  do {
    const resp = await web.conversations.members({
      channel: staging_channel,
      limit: 200,
      cursor,
    });
    if (!resp.ok) {
      throw `Failed to fetch staging channel members: ${resp.error}`;
    }
    for (const member of resp.members ?? []) {
      members.add(member);
    }
    cursor = resp.response_metadata?.next_cursor || undefined;
  } while (cursor);
  console.log(`Staging channel has ${members.size} members`);
  return members;
}

// Throws if the member list can't be fetched (most likely a missing
// groups:read scope), so callers can tell "not a moderator" apart from
// "couldn't check" instead of silently denying.
export async function isStagingMember(uid: string): Promise<boolean> {
  const now = Date.now();
  if (cache === null || now - cache.fetched_at > CACHE_TTL_MS) {
    cache = { members: await fetchMembers(), fetched_at: now };
    return cache.members.has(uid);
  }
  if (cache.members.has(uid)) {
    return true;
  }
  if (now - cache.fetched_at < MIN_REFETCH_AGE_MS) {
    return false;
  }
  cache = { members: await fetchMembers(), fetched_at: now };
  return cache.members.has(uid);
}
