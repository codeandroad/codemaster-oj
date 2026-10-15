"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Pause, Play, RotateCcw, X } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import type { WorkspaceSettings } from "./workspace-settings";

type TimerMode = "stopwatch" | "countdown";
const display = (seconds: number) => `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

const timerDurations = [10, 15, 30, 45, 60, 90];
const timerKey = (userId: string) => `campus-judge:workspace-timer:v1:${userId}`;

export function WorkspaceTimer({ settings, settingsReady, userId, problemKey, acceptedKey }: { settings: WorkspaceSettings; settingsReady: boolean; userId: string; problemKey: string; acceptedKey: string | null }) {
  const {locale}=useLocale();const tx=(zh:string,en:string)=>locale==="en"?en:zh;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TimerMode>("stopwatch");
  const [minutes, setMinutes] = useState(30);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [restored, setRestored] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const base = useRef(0);
  const started = useRef(0);
  const lastValue = useRef(0);
  const lastAccepted = useRef<string | null>(null);

  const reset = useCallback((nextMode: TimerMode = mode, nextMinutes = minutes) => {
    setRunning(false);
    const initial = nextMode === "countdown" ? nextMinutes * 60 : 0;
    setSeconds(initial);
    base.current = initial;
    lastValue.current = initial;
  }, [mode, minutes]);
  useEffect(() => {
    if (!settingsReady || restored) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(timerKey(userId)) ?? "null") as { mode?: TimerMode; minutes?: number; seconds?: number; running?: boolean; base?: number; started?: number; problemKey?: string } | null;
      if (saved && (saved.mode === "stopwatch" || saved.mode === "countdown") && timerDurations.includes(saved.minutes ?? -1)) {
        const nextMode = saved.mode, nextMinutes = saved.minutes!, now = Date.now();
        const elapsed = saved.running && typeof saved.started === "number" ? Math.max(0, Math.floor((now - saved.started) / 1000)) : 0;
        const original = typeof saved.base === "number" ? saved.base : Number(saved.seconds) || 0;
        const current = saved.running ? nextMode === "stopwatch" ? original + elapsed : Math.max(0, original - elapsed) : Number(saved.seconds) || 0;
        const next = settings.autoResetTimer && saved.problemKey !== problemKey ? nextMode === "countdown" ? nextMinutes * 60 : 0 : current;
        setMode(nextMode); setMinutes(nextMinutes); setSeconds(next);
        base.current = next; started.current = now; lastValue.current = next;
        setRunning(Boolean(saved.running && (!settings.autoResetTimer || saved.problemKey === problemKey) && (nextMode === "stopwatch" || next > 0)));
      }
    } catch { /* A damaged local timer snapshot starts a new personal timer. */ }
    setRestored(true);
  }, [settingsReady, restored, userId, problemKey, settings.autoResetTimer]);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(timerKey(userId), JSON.stringify({ mode, minutes, seconds, running, base: base.current, started: started.current, problemKey })); }
    catch { /* The timer still works until this page closes. */ }
  }, [restored, userId, problemKey, mode, minutes, seconds, running]);
  function sound() {
    try {
      const context = audio.current;
      if (!context || context.state !== "running") { setAudioError(true); return; }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.25);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.26);
    } catch { setAudioError(true); }
  }
  function toggleRunning() {
    if (running) { base.current = seconds; setRunning(false); return; }
    if (mode === "countdown" && seconds === 0) reset();
    base.current = mode === "countdown" && seconds === 0 ? minutes * 60 : seconds;
    started.current = Date.now();
    if (settings.superAlarm && !audio.current) {
      try { audio.current = new AudioContext(); void audio.current.resume().catch(() => setAudioError(true)); }
      catch { setAudioError(true); }
    } else if (settings.superAlarm && audio.current?.state === "suspended") void audio.current.resume().catch(() => setAudioError(true));
    setRunning(true);
  }
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - started.current) / 1000);
      const next = mode === "stopwatch" ? base.current + elapsed : Math.max(0, base.current - elapsed);
      if (settings.superAlarm && mode === "countdown") {
        if (lastValue.current > 600 && next <= 600 && next > 0) sound();
        if (lastValue.current > 0 && next === 0) sound();
      }
      lastValue.current = next;
      setSeconds(next);
      if (mode === "countdown" && next === 0) { base.current = 0; setRunning(false); }
    };
    const interval = window.setInterval(tick, 250);
    return () => clearInterval(interval);
  // All changing timer inputs restart the interval against its established baseline.
  }, [running, mode, settings.superAlarm]);
  useEffect(() => {
    if (!acceptedKey || acceptedKey === lastAccepted.current) return;
    lastAccepted.current = acceptedKey;
    if (settings.autoResetTimer) reset();
  // Accepted submissions are the only server events that reset this personal timer.
  }, [acceptedKey, settings.autoResetTimer, reset]);
  useEffect(() => () => { void audio.current?.close(); }, []);

  return <div className="relative"><button type="button" aria-label={`${tx("个人计时器","Personal timer")} ${display(seconds)}`} aria-expanded={open} onClick={() => setOpen(value => !value)} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-muted-foreground hover:bg-muted"><Clock3 size={15}/><span className="hidden font-mono sm:inline">{display(seconds)}</span></button>{open && <div role="dialog" aria-label={tx("个人计时器","Personal timer")} className="absolute right-0 top-10 z-40 w-72 rounded-xl border border-border bg-surface p-4 text-foreground shadow-xl"><div className="flex items-center justify-between"><strong className="text-sm">{tx("个人计时器","Personal timer")}</strong><button type="button" aria-label={tx("关闭计时器","Close timer")} className="rounded p-1 hover:bg-muted" onClick={() => setOpen(false)}><X size={16}/></button></div><div className="mt-4 flex gap-2">{(["stopwatch", "countdown"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); reset(value); }} className={`rounded px-2 py-1 text-xs font-semibold ${mode === value ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>{value === "stopwatch" ? tx("正向计时","Stopwatch") : tx("倒计时","Countdown")}</button>)}</div>{mode === "countdown" && <label className="mt-4 flex items-center justify-between text-xs font-semibold">{tx("时长","Duration")}<select aria-label={tx("倒计时时长","Countdown duration")} value={minutes} onChange={event => { const next = Number(event.target.value); setMinutes(next); reset(mode, next); }} className="rounded border border-border bg-surface px-2 py-1">{timerDurations.map(value => <option key={value} value={value}>{locale==="en"?`${value} min`:`${value} 分钟`}</option>)}</select></label>}<p aria-live="off" className="mt-4 text-center font-mono text-3xl tabular-nums">{display(seconds)}</p><div className="mt-4 flex justify-center gap-2"><button type="button" onClick={toggleRunning} className="flex min-h-9 items-center gap-1 rounded bg-primary px-3 text-xs font-semibold text-primary-foreground">{running ? <Pause size={14}/> : <Play size={14}/>} {running ? tx("暂停","Pause") : tx("开始","Start")}</button><button type="button" onClick={() => reset()} className="flex min-h-9 items-center gap-1 rounded border border-border px-3 text-xs font-semibold"><RotateCcw size={14}/>{tx("重置","Reset")}</button></div>{audioError && settings.superAlarm && <p role="status" className="mt-3 text-xs text-destructive">{tx("浏览器未允许播放提示音，请检查声音权限。","The browser blocked alert sounds. Check your sound permissions.")}</p>}<p className="mt-3 text-xs leading-5 text-muted-foreground">{tx("个人计时器；限时练习仍以服务器时间为准。","This personal timer does not affect the server time for timed practice.")}</p></div>}</div>;
}
