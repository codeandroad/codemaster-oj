"use client";

import type { Key } from "react";
import { Trophy } from "lucide-react";
import { ProfileAvatar } from "@/components/profile-hero";

type Leader = {
  key: Key;
  rank: number | null;
  name: string;
  avatar: string;
  points: number;
};

export function LeaderboardPodium({ leaders }: { leaders: Leader[] }) {
  if (!leaders.length) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {leaders.slice(0, 3).map(leader => {
        const tone = leader.rank === 1
          ? { card: "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950", trophy: "text-amber-700 dark:text-amber-300" }
          : leader.rank === 2
            ? { card: "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900", trophy: "text-slate-500 dark:text-slate-300" }
            : { card: "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950", trophy: "text-orange-800 dark:text-orange-300" };
        return (
          <div key={leader.key} className={`flex min-w-0 items-center gap-3 rounded-xl border p-4 ${tone.card}`}>
            <Trophy aria-hidden="true" className={`size-5 shrink-0 ${tone.trophy}`} />
            <ProfileAvatar avatar={leader.avatar} nickname={leader.name} />
            <div className="min-w-0">
              <p className="truncate font-semibold" title={leader.name}>{leader.name}</p>
              <p className="text-xs text-muted-foreground">#{leader.rank}</p>
            </div>
            <strong className="ml-auto text-xl tabular-nums">{leader.points}</strong>
          </div>
        );
      })}
    </div>
  );
}
