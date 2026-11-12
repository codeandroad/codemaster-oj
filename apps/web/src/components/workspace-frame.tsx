"use client";

import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { useLocale } from "./locale-context";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

/** The same compact navigation and page frame for every school and personal workspace. */
export function WorkspaceFrame({
  schoolName,
  navigation,
  breadcrumb,
  account,
  children,
  footer,
  student = false,
}: {
  schoolName: string;
  navigation: ReactNode;
  breadcrumb: ReactNode;
  account: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  student?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { locale } = useLocale();
  const closeNavigation = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("a,button")) setOpen(false);
  };
  const brand = (
    <div className="flex min-h-[76px] shrink-0 flex-col justify-center gap-1 border-b border-border px-4 py-2">
      <BrandLogo className="h-auto w-[160px] max-w-full shrink-0" />
      <p
        className="break-words text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]"
        title={schoolName}
      >
        {schoolName}
      </p>
    </div>
  );
  return (
    <div
      data-od-id="production-shell"
      className="production-shell min-h-screen bg-background text-foreground"
    >
      <div
        className={`grid min-h-screen ${student ? "md:grid-cols-[224px_minmax(0,1fr)]" : "md:grid-cols-[236px_minmax(0,1fr)]"}`}
      >
        <aside className="production-sidebar hidden flex-col border-r border-border bg-surface md:flex">
          {brand}
          <div className="min-h-0 flex-1 overflow-y-auto">{navigation}</div>
        </aside>
        <div className="min-w-0">
          <header className="flex min-h-14 items-center gap-2 border-b border-border bg-surface px-3 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 md:hidden"
              aria-label={locale === "en" ? "Open navigation" : "打开导航"}
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu size={18} />
            </Button>
            <div className="min-w-0 flex-1">{breadcrumb}</div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-3">
              {account}
            </div>
          </header>
          <main className="production-page-content mx-auto max-w-[1500px] space-y-3 px-4 py-4 sm:px-6">
            {children}
          </main>
          {footer}
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="left-0 top-0 h-dvh w-[min(85vw,300px)] max-w-none translate-x-0 translate-y-0 content-start overflow-auto rounded-none p-0 sm:rounded-none">
          <DialogTitle className="sr-only">
            {locale === "en" ? "Workspace navigation" : "工作区导航"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {schoolName}
          </DialogDescription>
          {brand}
          <div onClick={closeNavigation}>{navigation}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
