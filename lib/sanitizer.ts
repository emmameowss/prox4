// Slack autolinks "#123" as a channel reference, which can resolve to a real
// channel and render as "Private channel" in place of the number. A zero-width
// non-joiner after the hash defeats the autolinker and is invisible to readers.
export function confessionRef(id: number): string {
  return `#\u200c${id}`;
}

export function sanitize(message: string) {
  return message
    .replace(/<!(channel|here|everyone)>/g, "<redacted for mass ping risk>");
}
