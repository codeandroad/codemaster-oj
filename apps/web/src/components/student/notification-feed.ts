import type { Assignment } from "@/lib/production-api";

interface NotificationBase {
  id: string;
  createdAt: string;
  readAt: string | null;
}
interface GuestbookNotification extends NotificationBase {
  kind: "guestbook";
  messageId: string;
  profileIdentityId: string;
  body: string;
  authorNickname: string;
  practice?: boolean;
  interaction?: "message" | "reply" | "mention";
}
interface ScholarshipNotification extends NotificationBase {
  kind: "scholarship_grant" | "activity_reward";
  amount: number;
  reason?: string;
  activityTitle?: string;
}
interface FeedbackNotification extends NotificationBase {
  kind: "teacher_feedback";
  reviewId: string;
  problemTitle: string;
}
interface CourseApplicationNotification extends NotificationBase {
  kind: "course_application";
  courseId: string;
  courseTitle: string;
}
interface CourseApplicationResultNotification extends NotificationBase {
  kind: "course_application_result";
  listingId: string;
  courseTitle: string;
  outcome: "approved" | "rejected";
}

export type Notification = GuestbookNotification | ScholarshipNotification | FeedbackNotification | CourseApplicationNotification | CourseApplicationResultNotification;
export type AssignmentReminder = Pick<Assignment, "id" | "title" | "dueAt" | "publishedAt" | "createdAt">;

export const notificationTabs = ["social", "updates", "events"] as const;
export type NotificationTab = typeof notificationTabs[number];

const tabByKind = {
  guestbook: "social",
  scholarship_grant: "updates",
  teacher_feedback: "updates",
  course_application: "updates",
  course_application_result: "updates",
  activity_reward: "events",
} satisfies Record<Notification["kind"], NotificationTab>;

type FeedEntry = { tab: NotificationTab; timestamp: number } & (
  | { type: "notification"; item: Notification }
  | { type: "assignment"; item: AssignmentReminder }
);

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

export function notificationFeed(notifications: readonly Notification[] = [], assignments: readonly AssignmentReminder[] = []) {
  const ordered: FeedEntry[] = [
    ...notifications.map(item => ({ type: "notification" as const, item, tab: tabByKind[item.kind], timestamp: timestamp(item.createdAt) })),
    ...assignments.map(item => ({ type: "assignment" as const, item, tab: "events" as const, timestamp: timestamp(item.publishedAt ?? item.createdAt) })),
  ];
  ordered.sort((left, right) => right.timestamp - left.timestamp);

  const entries: Record<NotificationTab, FeedEntry[]> = { social: [], updates: [], events: [] };
  const unread: Record<NotificationTab, boolean> = { social: false, updates: false, events: false };
  for (const entry of ordered) {
    entries[entry.tab].push(entry);
    if (entry.type === "notification" && !entry.item.readAt) unread[entry.tab] = true;
  }
  return { entries, unread, latestTab: ordered[0]?.tab ?? "updates" };
}
