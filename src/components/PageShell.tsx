import React, { type ReactNode } from "react";
import AppMenubar from "@/components/AppMenubar";

/** Standard page frame: header + icon rail + a centered, readable column. */
export default function PageShell({
  title,
  subtitle,
  actions,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <AppMenubar />
      <main className="pt-14 lg:pl-16">
        <div className={`mx-auto w-full px-4 sm:px-6 py-6 ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-serif text-2xl font-bold tracking-tight">{title}</h1>
              {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function Section({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-border bg-card ${className}`}>
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-1 py-3 text-sm text-muted-foreground">{children}</div>;
}
