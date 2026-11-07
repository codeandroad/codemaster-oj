import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLoginDestination } from "../src/components/auth/login-destination.ts";

const legacy = { id: "legacy-school", legacy: true };
const alpha = { id: "alpha-school", legacy: false };
const beta = { id: "beta-school", legacy: false };
const schools = [alpha, legacy, beta];
const resolve = (user, extra = {}) => resolveLoginDestination({ user, schools, ...extra });

test("platform administrators land on platform management regardless of school or browser defaults", () => {
  for (const roles of [[], ["admin"], ["teacher"]]) {
    assert.deepEqual(resolve({ roles, platformAdmin: true, defaultSchoolId: alpha.id }, { preferredSchoolId: beta.id }), {
      href: "/platform", schoolId: null,
    });
  }
});

test("server default takes precedence over browser preference when both are current memberships", () => {
  assert.deepEqual(resolve({ roles: ["admin"], defaultSchoolId: alpha.id }, { preferredSchoolId: legacy.id }), {
    href: "/schools", schoolId: alpha.id,
  });
  assert.deepEqual(resolve({ roles: ["admin"], defaultSchoolId: legacy.id }, { preferredSchoolId: alpha.id }), {
    href: "/admin", schoolId: legacy.id,
  });
});

test("removed or foreign preferences cannot select unavailable schools", () => {
  assert.deepEqual(resolve({ roles: [], defaultSchoolId: "removed" }, { preferredSchoolId: beta.id }), {
    href: "/schools", schoolId: beta.id,
  });
  assert.deepEqual(resolve({ roles: ["teacher"], defaultSchoolId: "foreign" }, { preferredSchoolId: "removed" }), {
    href: "/teacher", schoolId: legacy.id,
  });
});

test("legacy administrators, teachers and students keep their role home without a preference", () => {
  for (const [roles, href] of [[["admin", "teacher"], "/admin"], [["teacher"], "/teacher"], [["student"], "/"]]) {
    assert.deepEqual(resolve({ roles }), { href, schoolId: legacy.id });
  }
});

test("a valid chosen new school is not overridden by an old-school global role", () => {
  assert.deepEqual(resolve({ roles: ["admin"] }, { preferredSchoolId: beta.id }), {
    href: "/schools", schoolId: beta.id,
  });
});

test("school members with no global roles land in their school; personal accounts land in practice", () => {
  assert.deepEqual(resolve({ roles: [] }), { href: "/schools", schoolId: alpha.id });
  assert.deepEqual(resolve({ roles: [] }, { schools: [], preferredSchoolId: alpha.id }), {
    href: "/practice", schoolId: null,
  });
});

test("a legacy membership never manufactures a legacy global role", () => {
  assert.deepEqual(resolve({ roles: [] }, { schools: [legacy] }), {
    href: "/schools", schoolId: legacy.id,
  });
});

test("explicit invitation intent opens the current workspace settings rather than a dialog", () => {
  const cases = [
    [{ roles: [], platformAdmin: true }, {}, "/platform?section=settings#schools", null],
    [{ roles: ["admin"] }, {}, "/admin/personal-settings#schools", legacy.id],
    [{ roles: ["teacher"] }, {}, "/teacher/settings#schools", legacy.id],
    [{ roles: ["student"] }, {}, "/student/settings#schools", legacy.id],
    [{ roles: [], defaultSchoolId: beta.id }, {}, "/schools?section=personal-settings#schools", beta.id],
    [{ roles: [] }, { schools: [] }, "/practice/settings#schools", null],
  ];
  for (const [user, extra, href, schoolId] of cases) {
    const destination = resolve(user, { ...extra, joinIntent: true });
    assert.deepEqual(destination, { href, schoolId });
    assert.ok(!destination.href.includes("join=1"));
  }
});
