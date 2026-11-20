import assert from "node:assert/strict";
import test from "node:test";
import { notificationFeed } from "../src/components/student/notification-feed.ts";

const earlier = "2026-11-16T00:00:00Z";
const later = "2026-11-18T08:00:00+08:00";
const notice = (kind, createdAt = earlier, readAt = null) => ({ id: kind, kind, createdAt, readAt });
const ids = entries => entries.map(entry => entry.item.id);

test("groups each inbox type and tracks category unread dots separately", () => {
  const feed = notificationFeed([
    notice("guestbook", later),
    notice("scholarship_grant", earlier, later),
    notice("course_application", earlier, later),
    notice("course_application_result", earlier, later),
    notice("teacher_feedback", earlier, later),
    notice("activity_reward"),
    notice("assignment_change"),
    notice("assignment_reminder"),
  ]);

  assert.deepEqual(ids(feed.entries.social), ["guestbook"]);
  assert.deepEqual(ids(feed.entries.updates), ["scholarship_grant", "course_application", "course_application_result", "teacher_feedback"]);
  assert.deepEqual(ids(feed.entries.events), ["activity_reward", "assignment_change", "assignment_reminder"]);
  assert.deepEqual(feed.unread, { social: true, updates: false, events: true });
  assert.equal(feed.latestTab, "social");
});

test("selects the newest entry across categories even if it is already read", () => {
  const feed = notificationFeed([notice("guestbook"), notice("teacher_feedback", later, later)]);
  assert.equal(feed.latestTab, "updates");
  assert.deepEqual(feed.unread, { social: true, updates: false, events: false });
});

test("defaults to Updates when there are no dated inbox entries or assignments", () => {
  const feed = notificationFeed();
  assert.equal(feed.latestTab, "updates");
  assert.deepEqual(feed.entries, { social: [], updates: [], events: [] });
});
