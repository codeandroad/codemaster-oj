import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLoginDestination } from "../src/components/auth/login-destination.ts";

const original = { id: "original-school", roles: ["school_admin"] };
const alpha = { id: "alpha-school", roles: ["student"] };
const beta = { id: "beta-school", roles: ["student"] };
const schools = [alpha, original, beta];
const resolve = (user, extra = {}) => resolveLoginDestination({ user, schools, ...extra });

test("platform administrators land on platform management regardless of school or browser defaults", () => {
  for (const roles of [[], ["admin"], ["teacher"]]) {
    assert.deepEqual(resolve({ roles, platformAdmin: true, defaultSchoolId: alpha.id }, { preferredSchoolId: beta.id }), {
      href: "/platform", schoolId: null,
    });
  }
});

test("server default takes precedence over browser preference when both are current memberships", () => {
  assert.deepEqual(resolve({ roles: ["admin"], defaultSchoolId: alpha.id }, { preferredSchoolId: original.id }), {
    href: "/schools", schoolId: alpha.id,
  });
  assert.deepEqual(resolve({ roles: ["admin"], defaultSchoolId: original.id }, { preferredSchoolId: alpha.id }), {
    href: "/schools", schoolId: original.id,
  });
});

test("removed or foreign preferences cannot select unavailable schools", () => {
  assert.deepEqual(resolve({ roles: [], defaultSchoolId: "removed" }, { preferredSchoolId: beta.id }), {
    href: "/schools", schoolId: beta.id,
  });
  assert.deepEqual(resolve({ roles: ["teacher"], defaultSchoolId: "foreign" }, { preferredSchoolId: "removed" }), {
    href: "/schools", schoolId: alpha.id,
  });
});

test("school selection follows the membership list for every former global role", () => {
  for (const roles of [["admin", "teacher"], ["teacher"], ["student"]]) {
    assert.deepEqual(resolve({roles}), {href:"/schools",schoolId:alpha.id});
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

test("a original membership never manufactures a original global role", () => {
  assert.deepEqual(resolve({ roles: [] }, { schools: [original] }), {
    href: "/schools", schoolId: original.id,
  });
});

test("explicit invitation intent opens the current workspace settings rather than a dialog", () => {
  const cases = [
    [{ roles: [], platformAdmin: true }, {}, "/platform?section=settings#schools", null],
    [{ roles: ["admin"] }, {}, "/schools?section=personal-settings#schools", alpha.id],
    [{ roles: ["teacher"] }, {}, "/schools?section=personal-settings#schools", alpha.id],
    [{ roles: ["student"] }, {}, "/schools?section=personal-settings#schools", alpha.id],
    [{ roles: [], defaultSchoolId: beta.id }, {}, "/schools?section=personal-settings#schools", beta.id],
    [{ roles: [] }, { schools: [] }, "/practice/settings#schools", null],
  ];
  for (const [user, extra, href, schoolId] of cases) {
    const destination = resolve(user, { ...extra, joinIntent: true });
    assert.deepEqual(destination, { href, schoolId });
    assert.ok(!destination.href.includes("join=1"));
  }
});
