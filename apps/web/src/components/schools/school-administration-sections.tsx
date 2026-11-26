"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SchoolClasses } from "./school-classes";
import { SchoolCourses } from "./school-courses";
import { SchoolDirectory } from "./school-administration";
import { useSchoolText, type School } from "./school-ui";

export type SchoolSection = "members" | "identities" | "classes" | "courses";

export function SchoolAdministration({
  school,
  members,
  refreshRevision,
  actions,
  navigationDisabled = false,
  currentSection,
}: {
  school: School;
  members: ReactNode;
  refreshRevision: number;
  actions: ReactNode;
  navigationDisabled?: boolean;
  currentSection?: SchoolSection;
}) {
  const text = useSchoolText();
  const admin = school.roles.includes("school_admin");
  const identityId = useSearchParams().get("identityId");
  const [section, setSection] = useState<SchoolSection>("classes");
  const sections = [
    ["classes", text("Classes", "班级")],
    ["courses", text("Courses", "课程")],
    ["identities", text("Identities", "身份档案")],
    ["members", text("Members", "成员")],
  ] as const;
  const requestedSection = currentSection ?? section;
  const activeSection =
    admin || requestedSection === "courses" ? requestedSection : "classes";
  const base = `schools/${school.id}`;
  return (
    <div
      className={
        activeSection === "classes" || activeSection === "courses"
          ? ""
          : "rounded-lg border border-border bg-surface p-4"
      }
    >
      {!currentSection && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
          <div
            role="group"
            aria-label={text("School sections", "学校功能")}
            className="flex flex-wrap gap-1"
          >
            {(admin ? sections : sections.slice(0, 2)).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={value === activeSection ? "primary" : "ghost"}
                aria-pressed={value === activeSection}
                disabled={navigationDisabled}
                onClick={() => setSection(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {actions}
        </div>
      )}
      {activeSection === "members" && members}
      {activeSection === "courses" && (
        <SchoolCourses school={school} refreshRevision={refreshRevision} />
      )}
      {activeSection === "identities" && (
        <SchoolDirectory
          base={base}
          school={school}
          refreshRevision={refreshRevision}
          highlightedIdentityId={identityId}
        />
      )}
      {activeSection === "classes" && (
        <SchoolClasses school={school} refreshRevision={refreshRevision} />
      )}
    </div>
  );
}
