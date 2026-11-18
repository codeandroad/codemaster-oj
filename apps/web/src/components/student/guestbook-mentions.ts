export interface Mention {
  id: string;
  nickname: string;
}

export interface MentionRange {
  start: number;
  end: number;
}

export type DraftMention = Mention & MentionRange;

export function mentionQuery(text: string, cursor: number, mentions: readonly DraftMention[]) {
  const match = /(?<![a-zA-Z0-9_＠@])[@＠]([\p{L}\p{M}\p{N}_. -]{0,50})$/u.exec(text.slice(0, cursor));
  if (!match || mentions.some(mention => mention.start <= match.index && match.index < mention.end)) return null;
  const suffix = /^[\p{L}\p{M}\p{N}_.-]*/u.exec(text.slice(cursor))?.[0] ?? "";
  return { start: match.index, end: cursor + suffix.length, query: match[1].trim() };
}

export function moveMentions(mentions: readonly DraftMention[], start: number, end: number, insertedLength: number) {
  const delta = insertedLength - (end - start);
  return mentions.flatMap(mention => {
    if (mention.end <= start) return [mention];
    if (mention.start >= end) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    return [];
  });
}

export function editMentionRanges(before: string, after: string, cursor: number, mentions: DraftMention[]) {
  if (before === after) return mentions;
  let start = 0;
  while (start < cursor && start < before.length && before[start] === after[start]) start++;
  let suffix = 0;
  while (suffix < after.length - cursor && suffix < before.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return moveMentions(mentions, start, before.length - suffix, after.length - start - suffix);
}
