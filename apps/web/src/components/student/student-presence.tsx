"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { ProfileAvatar } from "@/components/profile-hero";
import { useLocale } from "@/components/locale-context";
import { ApiError, productionApi } from "@/lib/production-api";
import styles from "./student-presence.module.css";

const presenceChanged = "campus-judge:presence-updated";
type Presence = { onlineCount: number; total: number; page: number; pageSize: number; items: { identityId: string; displayName: string; avatar?: string | null }[] };

/** A visible authenticated student tab renews its own session, never another identity. */
export function StudentPresenceHeartbeat({ identityId }: { identityId: string }) {
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let stopped = false;
    async function beat() {
      if (document.visibilityState !== "visible" || pending || stopped) return;
      pending = true;
      try {
        await productionApi("presence/heartbeat", { method: "POST", body: {}, signal: controller.signal });
        if (!controller.signal.aborted) window.dispatchEvent(new Event(presenceChanged));
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || (error.status === 403 && error.code === "FORBIDDEN"))) stopped = true;
        // Presence is optional; a transient outage must not interrupt coding or submission.
      } finally { pending = false; }
    }
    void beat();
    const timer = window.setInterval(() => void beat(), 30_000);
    const visible = () => void beat();
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [identityId]);
  return null;
}

export function OnlineStudents({ identityId }: { identityId: string }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Presence | null>(null);
  const [resultKey, setResultKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const requestKey = `${open ? query : ""}:${open ? page : 1}:${open ? 20 : 1}`;
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let queued = false;
    async function refresh() {
      if (document.visibilityState !== "visible" || controller.signal.aborted) return;
      if (pending) { queued = true; return; }
      pending = true;
      try {
        const params = new URLSearchParams({ q: open ? query : "", page: String(open ? page : 1), pageSize: open ? "20" : "1" });
        const next = await productionApi<Presence>(`presence?${params}`, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setResult(next); setResultKey(requestKey); setError(false); setLoading(false);
          // Presence expires while browsing: keep the current page reachable.
          const lastPage = Math.max(1, Math.ceil(next.total / next.pageSize));
          if (open && page > lastPage) setPage(lastPage);
        }
      } catch {
        if (!controller.signal.aborted) { setError(true); setLoading(false); }
      } finally {
        pending = false;
        if (queued) { queued = false; void refresh(); }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const refreshVisible = () => void refresh();
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener(presenceChanged, refreshVisible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshVisible); window.removeEventListener(presenceChanged, refreshVisible); };
  }, [open, query, page, retry, requestKey]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function collapse() { setOpen(false); trigger.current?.focus(); }
  function toggle() {
    if (open) { collapse(); return; }
    setSearch(""); setQuery(""); setPage(1); setLoading(true); setOpen(true);
  }
  const waiting = loading || resultKey !== requestKey || search.trim() !== query;
  return <div ref={container} className={styles.footer} data-od-id="online-students" onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); collapse(); }
  }}>
    {open && <section id={panelId} aria-label={tx("全站在线学生", "Students online across the site")} className={styles.popover}>
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={14} aria-hidden="true"/><input ref={input} value={search} maxLength={80} aria-label={tx("搜索在线学生", "Search online students")} placeholder={tx("搜索在线学生", "Search students")} onChange={event => { setSearch(event.target.value); setPage(1); }}/></label>
        <button type="button" className={styles.minimize} onClick={collapse} aria-label={tx("最小化在线列表", "Minimize online list")} title={tx("最小化", "Minimize")}><ChevronDown size={16}/></button>
      </div>
      <div className={styles.list} aria-busy={waiting}>
        {error ? <p role="status" className={styles.message}>{tx("暂时无法获取在线列表。", "Online list is unavailable.")} <button type="button" onClick={() => { setLoading(true); setRetry(value => value + 1); }}>{tx("重试", "Retry")}</button></p> : waiting ? <p className={styles.message} role="status">{tx("加载中…", "Loading…")}</p> : result?.items.length ? <ul>{result.items.map(person => <li key={person.identityId}><AppLink prefetch={false} href={`/student/people/${encodeURIComponent(person.identityId)}`} className={styles.person}>
          <ProfileAvatar avatar={person.avatar} nickname={person.displayName}/><span className={styles.name} title={person.displayName}>{person.displayName}</span>{person.identityId === identityId && <span className={styles.you}>{tx("我", "You")}</span>}
        </AppLink></li>)}</ul> : <p className={styles.message} role="status">{query ? tx("没有匹配的在线学生", "No online students match") : tx("目前没有在线学生", "No students online right now")}</p>}
      </div>
      {!error && !waiting && result && result.total > result.pageSize && <nav className={styles.pagination} aria-label={tx("在线列表分页", "Online list pages")}><button type="button" disabled={page <= 1} onClick={() => { setLoading(true); setPage(value => value - 1); }}>{tx("上一页", "Previous")}</button><span>{page} / {Math.ceil(result.total / result.pageSize)}</span><button type="button" disabled={page * result.pageSize >= result.total} onClick={() => { setLoading(true); setPage(value => value + 1); }}>{tx("下一页", "Next")}</button></nav>}
    </section>}
    <button ref={trigger} type="button" className={styles.trigger} aria-expanded={open} aria-controls={panelId} onClick={toggle} title={tx("全站当前在线学生", "Students currently online across the site")}>
      <span className={error ? styles.unavailable : styles.dot} aria-hidden="true"/>{error ? tx("在线状态不可用", "Online unavailable") : result ? tx(`${result.onlineCount} 人在线`, `${result.onlineCount} Online`) : tx("在线人数…", "Online…")}<ChevronUp size={13} className={open ? styles.flipped : undefined} aria-hidden="true"/>
    </button>
  </div>;
}
