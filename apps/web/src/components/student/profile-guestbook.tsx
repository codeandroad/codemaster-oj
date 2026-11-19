"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { Heart, Quote, Smile, Trash2 } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useLocale } from "@/components/locale-context";
import { productionApi } from "@/lib/production-api";
import { date, Feedback, State, textarea, useData, useMutation } from "./data-state";
import { editMentionRanges, mentionQuery, moveMentions, type DraftMention, type Mention, type MentionRange } from "./guestbook-mentions";

interface Message {
  id: string;
  body: string;
  createdAt: string;
  author: { id?: string; nickname: string; avatar: string | null };
  canDelete: boolean;
  threadId: string | null;
  replyCount: number;
  quote: { id: string; body: string | null; nickname: string | null } | null;
  mentions: (Mention & { ranges?: MentionRange[] | null })[];
  likeCount: number;
  liked: boolean;
}
interface MessagesPage {
  items: Message[];
  total: number;
  replyTotal: number;
  page: number;
}
const pageSize = 5;
const emoji = ["😀", "😂", "😊", "👍", "👏", "🎉", "🙌", "❤️", "💪", "🔥", "✨", "🤔", "🙏", "💯"];
const actionClass = "h-9 gap-1.5 px-2 font-medium";

function QuotePreview({ nickname, body }: { nickname: string | null; body: string | null }) {
  const { locale } = useLocale();
  return <blockquote className="mb-2 flex min-w-0 gap-2 rounded-r border-l-2 border-primary/35 bg-surface-subtle px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
    <Quote size={14} className="mt-0.5 shrink-0" aria-hidden="true"/>
    <span className="line-clamp-2 min-w-0 break-words">{body === null
      ? locale === "zh" ? "原留言已不可见" : "Quoted message unavailable"
      : <><b>{nickname}</b><span className="mx-1.5">·</span>{body}</>}</span>
  </blockquote>;
}

function Composer({ base, quote, onSaved, onCancel }: {
  base: string; quote?: Message; onSaved: () => void; onCancel?: () => void;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<DraftMention[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const post = useMutation();
  const limit = quote ? 300 : 500;
  const title = quote ? (zh ? `引用回复 ${quote.author.nickname}` : `Reply to ${quote.author.nickname}`) : (zh ? "留言内容" : "Message");
  const active = cursor !== null && !composing && !dismissed && !post.busy && mentions.length < 5
    ? mentionQuery(draft, cursor, mentions) : null;
  const query = active?.query ?? null;
  const candidates = useData<{ items: Mention[]; query: string }>(
    query !== null && query === search ? `${base}/mentions?q=${encodeURIComponent(query)}` : "",
  );
  const options = active && candidates.data?.query === query && !candidates.error ? candidates.data.items : [];
  const activeIndex = Math.min(highlight, options.length - 1);
  const optionId = (index: number) => `${id}-mention-${index}`;
  const activeOption = useRef<HTMLLIElement>(null);

  useEffect(() => { if (quote) field.current?.focus(); }, [quote]);
  useEffect(() => {
    if (query === null) return;
    const timer = window.setTimeout(() => setSearch(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (activeIndex > 0) activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function replaceText(start: number, end: number, text: string, mention?: Mention) {
    const next = draft.slice(0, start) + text + draft.slice(end);
    if (next.length > limit) return;
    const updated = moveMentions(mentions, start, end, text.length);
    if (mention) updated.push({ ...mention, start, end: start + mention.nickname.length + 1 });
    setMentions(updated);
    setDraft(next);
    setEmojiOpen(false);
    setCursor(start + text.length);
    field.current?.focus();
    requestAnimationFrame(() => field.current?.setSelectionRange(start + text.length, start + text.length));
  }

  function insertEmoji(symbol: string) {
    const element = field.current;
    if (element) replaceText(element.selectionStart, element.selectionEnd, symbol);
  }

  function chooseMention(mention: Mention) {
    if (active) replaceText(active.start, active.end, `@${mention.nickname} `, mention);
  }

  return <form method="post" aria-labelledby={`${id}-label`} className={quote ? "mt-2 rounded-lg border border-border bg-surface-subtle p-3" : "mt-3"}
    onSubmit={event => {
      event.preventDefault();
      if (post.busy || !draft.trim()) return;
      void post.run(async () => {
        const leading = draft.length - draft.trimStart().length;
        await productionApi(`${base}/messages`, { method: "POST", body: {
          body: draft.trim(), quoteId: quote?.id,
          mentions: mentions.map(({ id, start, end }) => ({ id, start: start - leading, end: end - leading })),
        } });
        setDraft(""); setMentions([]); setEmojiOpen(false); setCursor(null);
        if (!quote) post.success(zh ? "留言已发布。" : "Message posted.");
        onSaved();
      });
    }}>
    {quote && <QuotePreview nickname={quote.author.nickname} body={quote.body}/>}
    <label id={`${id}-label`} htmlFor={id} className="block text-sm font-semibold">{title}</label>
    <div className="relative">
      <textarea ref={field} id={id} name="body" className={`mt-1.5 ${textarea}`} rows={quote ? 3 : 2} maxLength={limit} required
        aria-describedby={`${id}-count ${id}-mention-hint`} value={draft} readOnly={post.busy}
        aria-autocomplete="list" aria-haspopup="listbox" aria-controls={active ? `${id}-mentions` : undefined}
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        onChange={event => {
          const { value, selectionEnd } = event.currentTarget;
          setMentions(current => editMentionRanges(draft, value, selectionEnd, current));
          setDraft(value); setCursor(selectionEnd); setDismissed(false); setHighlight(0);
        }}
        onSelect={event => {
          const { selectionStart, selectionEnd } = event.currentTarget;
          setCursor(selectionStart === selectionEnd ? selectionEnd : null);
        }}
        onBlur={() => { setCursor(null); setDismissed(false); }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={event => {
          if (!active || composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setDismissed(true);
          } else if (options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setHighlight((activeIndex + step + options.length) % options.length);
          } else if (activeIndex >= 0 && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            chooseMention(options[activeIndex]);
          }
        }}
        placeholder={quote ? (zh ? "写下你的回复…" : "Write your reply…") : (zh ? "写下你的留言…" : "Write a message…")}/>
      <span id={`${id}-mention-hint`} className="sr-only">{zh ? "输入 @ 和昵称来提及用户" : "Type @ and a nickname to mention a user"}</span>
      {active && <div className="absolute inset-x-0 top-full z-20 -mt-1 rounded-md border border-border bg-surface shadow-md">
        <ul id={`${id}-mentions`} role="listbox" aria-label={zh ? "用户建议" : "Suggested users"} className="max-h-48 overflow-y-auto">
          {options.map((mention, index) => <li key={mention.id} id={optionId(index)} role="option" aria-selected={index === activeIndex}
            ref={index === activeIndex ? activeOption : undefined}
            className="cursor-pointer break-words px-3 py-2 text-sm hover:bg-accent aria-selected:bg-accent"
            onPointerDown={event => event.preventDefault()} onClick={() => chooseMention(mention)}>
            @{mention.nickname}
          </li>)}
        </ul>
        {!options.length && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
          {search !== query || candidates.loading || (!candidates.error && candidates.data?.query !== query)
            ? (zh ? "正在查找…" : "Searching…")
            : candidates.error ? (zh ? "暂时无法查找用户" : "User search is unavailable")
              : (zh ? "没有匹配的用户" : "No matching users")}
        </p>}
      </div>}
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" variant="ghost" className="size-9 px-0" aria-label={zh ? "选择 emoji" : "Choose emoji"} aria-expanded={emojiOpen} disabled={post.busy} onClick={() => setEmojiOpen(!emojiOpen)}><Smile size={17} aria-hidden="true"/></Button>
        <span id={`${id}-count`} className="px-1 text-xs tabular-nums text-muted-foreground">{draft.length}/{limit}</span>
      </div>
      <div className="flex gap-2">
        {onCancel && <Button type="button" size="sm" variant="ghost" disabled={post.busy} onClick={onCancel}>{zh ? "取消" : "Cancel"}</Button>}
        <Button type="submit" size="sm" disabled={post.busy || !draft.trim()}>{quote ? (zh ? "发布回复" : "Post reply") : (zh ? "发布留言" : "Post message")}</Button>
      </div>
    </div>
    {emojiOpen && <div role="group" aria-label={zh ? "常见 emoji" : "Common emoji"} className="mt-2 flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1.5">
      {emoji.map(symbol => <Button key={symbol} type="button" size="sm" variant="ghost" className="size-9 px-0 text-base" onClick={() => insertEmoji(symbol)}>{symbol}</Button>)}
    </div>}
    <Feedback action={post}/>
  </form>;
}

function MessageBody({ item, peoplePath }: { item: Message; peoplePath: string }) {
  const inline = item.mentions.flatMap(mention => (mention.ranges ?? []).map(range => ({ ...range, id: mention.id })))
    .sort((left, right) => left.start - right.start);
  const legacy = item.mentions.filter(mention => !mention.ranges);
  const parts = inline.map(({ id, start, end }, index) => (
    <span key={start}>{item.body.slice(index > 0 ? inline[index - 1].end : 0, start)}<AppLink className="text-primary hover:underline" href={`${peoplePath}/${encodeURIComponent(id)}`}>
      {item.body.slice(start, end)}
    </AppLink></span>
  ));
  return <>
    {!!legacy.length && <p className="mb-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-sm text-primary">
      {legacy.map(mention => <AppLink key={mention.id} className="break-all hover:underline" href={`${peoplePath}/${encodeURIComponent(mention.id)}`}>@{mention.nickname}</AppLink>)}
    </p>}
    <p className="whitespace-pre-wrap break-words text-sm leading-6">{parts}{item.body.slice(inline.at(-1)?.end ?? 0)}</p>
  </>;
}

function MessageRow({ item, base, peoplePath, onReply, onDelete, children }: {
  item: Message; base: string; peoplePath: string;
  onReply: (item: Message, trigger: HTMLButtonElement) => void;
  onDelete: (item: Message, trigger: HTMLButtonElement) => void;
  children?: React.ReactNode;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const like = useMutation();
  const [reaction, setReaction] = useState<{ source: Message; liked: boolean; likeCount: number }>();
  const { liked, likeCount } = reaction?.source === item ? reaction : item;
  const authorPath = item.author.id ? `${peoplePath}/${encodeURIComponent(item.author.id)}` : null;
  const avatar = item.author.avatar
    ? <Image src={item.author.avatar} width={32} height={32} unoptimized alt="" className="size-8 shrink-0 rounded-full object-cover"/>
    : <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-primary">{Array.from(item.author.nickname)[0]}</span>;
  return <article className="flex min-w-0 gap-2.5">
    {authorPath ? <AppLink href={authorPath} className="shrink-0 self-start">{avatar}</AppLink> : avatar}
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        {authorPath
          ? <AppLink href={authorPath} className="max-w-full break-words text-sm font-semibold hover:underline">{item.author.nickname}</AppLink>
          : <span className="max-w-full break-words text-sm font-semibold">{item.author.nickname}</span>}
        <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>{date(item.createdAt, locale)}</time>
      </div>
      <div className="mt-1.5">
        {item.quote && <QuotePreview nickname={item.quote.nickname} body={item.quote.body}/>}
        <MessageBody item={item} peoplePath={peoplePath}/>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1">
        <Button type="button" variant="ghost" size="sm" className={`${actionClass} ${liked ? "text-primary" : ""}`}
          aria-pressed={liked} aria-disabled={like.busy}
          onClick={() => {
            if (!like.busy) void like.run(async () => {
              const result = await productionApi<{ liked: boolean; likeCount: number }>(`${base}/messages/${item.id}/like`, {
                method: "POST", body: { liked: !liked },
              });
              setReaction({ source: item, ...result });
            });
          }}>
          <Heart size={15} fill={liked ? "currentColor" : "none"} aria-hidden="true"/>{zh ? "赞" : "Like"}{likeCount > 0 && <span className="tabular-nums">{likeCount}</span>}
        </Button>
        <Button type="button" variant="ghost" size="sm" className={actionClass} onClick={event => onReply(item, event.currentTarget)}>
          <Quote size={15} aria-hidden="true"/>{zh ? "引用回复" : "Quote reply"}
        </Button>
        {item.canDelete && <Button type="button" variant="ghost" size="sm" className={`${actionClass} hover:text-destructive`} onClick={event => onDelete(item, event.currentTarget)}>
          <Trash2 size={15} aria-hidden="true"/>{zh ? "删除" : "Delete"}
        </Button>}
      </div>
      <Feedback action={like}/>
      {children}
    </div>
  </article>;
}

function Paging({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const { locale } = useLocale();
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span>{page}/{pages}</span>
    <Button type="button" size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>{locale === "zh" ? "上一页" : "Previous"}</Button>
    <Button type="button" size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>{locale === "zh" ? "下一页" : "Next"}</Button>
  </div>;
}

function Thread({ item, base, peoplePath, version, onDelete, changed }: {
  item: Message; base: string; peoplePath: string; version: number;
  onDelete: (item: Message, trigger: HTMLButtonElement) => void; changed: () => void;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [quote, setQuote] = useState<Message | null>(null);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const replies = useData<MessagesPage>(expanded ? `${base}/messages/${item.id}/replies?page=${page}&pageSize=${pageSize}` : "", version);
  const currentReplies = replies.data?.page === page ? replies.data : null;
  const lastPage = Math.max(1, Math.ceil(item.replyCount / pageSize));
  useEffect(() => { if (page > lastPage) setPage(lastPage); }, [lastPage, page]);
  function beginReply(target: Message, trigger: HTMLButtonElement) {
    setQuote(target); returnFocus.current = trigger;
  }
  function endReply() {
    setQuote(null); returnFocus.current?.focus();
  }
  return <MessageRow {...{ item, base, peoplePath, onDelete }} onReply={beginReply}>
    {quote && <Composer key={quote.id} base={base} quote={quote} onCancel={endReply} onSaved={() => {
      endReply(); setPage(1); setExpanded(true); changed();
    }}/>}
    {item.replyCount > 0 && <Button type="button" size="sm" variant="ghost" className="mt-1 px-2 text-primary" aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}>{expanded
        ? (zh ? "收起回复" : "Hide replies")
        : (zh ? `查看 ${item.replyCount} 条回复` : `View ${item.replyCount} ${item.replyCount === 1 ? "reply" : "replies"}`)}</Button>}
    {expanded && item.replyCount > 0 && <div className="mt-2 border-l border-border pl-2 sm:pl-3">
      <State data={{ ...replies, data: currentReplies, loading: replies.loading || (!currentReplies && !replies.error) }}>
        <ol className="divide-y divide-border">{currentReplies?.items.map(reply => <li key={reply.id} className="py-2">
          <MessageRow item={reply} {...{ base, peoplePath, onDelete }} onReply={beginReply}/>
        </li>)}</ol>
        <Paging page={page} total={item.replyCount} onChange={setPage}/>
      </State>
    </div>}
  </MessageRow>;
}

export function ProfileGuestbook({ base, peoplePath, canPost, refreshVersion }: {
  base: string; peoplePath: string; canPost: boolean; refreshVersion: number;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Message | null>(null);
  const [notice, setNotice] = useState("");
  const target = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const messages = useData<MessagesPage>(`${base}/messages?page=${page}&pageSize=${pageSize}`, version + refreshVersion);
  const data = messages.data?.page === page ? messages.data : null;
  const deletion = useMutation();
  const changed = () => setVersion(current => current + 1);
  useEffect(() => {
    if (window.location.hash === "#profile-guestbook") heading.current?.scrollIntoView();
  }, []);

  return <div ref={heading} id="profile-guestbook" tabIndex={-1} className="scroll-mt-20">
    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      {data ? <span>{zh ? `${data.total} 条留言 · ${data.replyTotal} 条回复`
        : `${data.total} ${data.total === 1 ? "message" : "messages"} · ${data.replyTotal} ${data.replyTotal === 1 ? "reply" : "replies"}`}</span> : <span/>}
      <Button type="button" variant="ghost" size="sm" disabled={messages.loading} onClick={changed}>{zh ? "刷新留言" : "Refresh messages"}</Button>
    </div>
    {canPost && <Composer base={base} onSaved={() => { setPage(1); changed(); }}/>}
    {notice && <p role="status" className="mt-2 text-sm text-success">{notice}</p>}
    <State data={{ ...messages, data, loading: messages.loading || (!data && !messages.error) }}>
      {data?.items.length ? <ol className="mt-2 divide-y divide-border border-t border-border">
        {data.items.map(item => <li key={item.id} className="py-3"><Thread {...{ item, base, peoplePath, changed }}
          version={version + refreshVersion} onDelete={(message, trigger) => {
            deletion.reset(); setNotice(""); target.current = trigger; setSelected(message);
          }}/></li>)}
      </ol> : <p className="mt-3 rounded-md bg-surface-subtle p-3 text-sm text-muted-foreground">{zh ? "还没有留言。" : "No messages yet."}</p>}
      <Paging page={page} total={data?.total ?? 0} onChange={setPage}/>
    </State>
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !deletion.busy) setSelected(null); }}>
      <DialogContent onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); (target.current?.isConnected ? target.current : heading.current)?.focus(); }}>
        <DialogTitle>{selected?.threadId ? (zh ? "删除回复" : "Delete reply") : (zh ? "删除留言" : "Delete message")}</DialogTitle>
        <DialogDescription>{selected?.replyCount
          ? (zh ? "删除后，这条留言及其回复将从主页隐藏。" : "This message and its replies will be hidden from the profile.")
          : (zh ? "删除后，这条内容将从主页隐藏。" : "This entry will be hidden from the profile.")}</DialogDescription>
        <Feedback action={deletion}/>
        <DialogFooter>
          <Button ref={cancel} type="button" variant="secondary" disabled={deletion.busy} onClick={() => setSelected(null)}>{zh ? "取消" : "Cancel"}</Button>
          <Button type="button" variant="destructive" disabled={deletion.busy || !selected} onClick={() => {
            if (!selected || deletion.busy) return;
            void deletion.run(async () => {
              await productionApi(`${base}/messages/${selected.id}`, { method: "DELETE" });
              if (!selected.threadId && data?.items.length === 1 && page > 1) setPage(page - 1);
              target.current = null;
              setNotice(selected.threadId ? (zh ? "回复已删除。" : "Reply deleted.") : (zh ? "留言已删除。" : "Message deleted."));
              setSelected(null); changed();
            });
          }}>{zh ? "确认删除" : "Delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
