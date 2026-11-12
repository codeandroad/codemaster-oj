"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { StudentPresenceCard } from "./student-presence-card";

export function ClassStudentPopover({ anchor, id, identityId, label, onClose, onDismiss }: {
  anchor: HTMLButtonElement; id: string; identityId: string; label: string;
  onClose: () => void; onDismiss: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    function position() {
      const row = anchor.getBoundingClientRect();
      const list = anchor.closest("ul")?.getBoundingClientRect();
      if (!anchor.isConnected || row.bottom <= 0 || row.top >= window.innerHeight || (list && (row.bottom <= list.top || row.top >= list.bottom))) { onDismiss(); return; }
      const width = Math.min(288, window.innerWidth - 16);
      const below = window.innerHeight - row.bottom - 12;
      const above = row.top - 12;
      const upwards = below < 160 && above > below;
      element!.style.width = `${width}px`;
      element!.style.maxHeight = `${Math.max(0, Math.min(280, upwards ? above : below))}px`;
      element!.style.left = `${Math.max(8, Math.min(row.right - width, window.innerWidth - width - 8))}px`;
      element!.style.top = `${upwards ? Math.max(8, row.top - element!.offsetHeight - 4) : row.bottom + 4}px`;
    }
    function outside(event: Event) {
      if (event.target instanceof Node && !element!.contains(event.target) && !anchor.contains(event.target)) onDismiss();
    }
    position();
    element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(element); observer.observe(anchor);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      observer.disconnect(); window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside);
    };
  }, [anchor, onDismiss]);
  return createPortal(<div ref={panel} id={id} role="dialog" aria-label={label} className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-border bg-surface p-1 text-xs text-foreground shadow-lg" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <StudentPresenceCard identityId={identityId} variant="disclosure" onBack={onClose} profileHref={`/student/people/${encodeURIComponent(identityId)}`}/>
  </div>, document.body);
}
