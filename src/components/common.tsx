import * as React from "react";
import { hashIndex, initials } from "@/lib/format";
import { SOURCE_LABEL, SOURCE_SHORT, type SourceKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Circle with initials on one of six muted tints picked from a hash of the name. */
export function PersonAvatar({ name, size = 32, className }: { name: string; size?: 24 | 32 | 40 | 56; className?: string }) {
  const px = { 24: "size-6 text-[10px]", 32: "size-8 text-xs", 40: "size-10 text-sm", 56: "size-14 text-lg" }[size];
  return (
    <span aria-hidden className={cn("grid shrink-0 select-none place-items-center rounded-full font-semibold", px, `tint-${hashIndex(name, 6)}`, className)}>
      {initials(name.replace(/^@/, "")) || "?"}
    </span>
  );
}

/** Rounded square with the first letter of a company. */
export function Monogram({ name, size = 32, className }: { name: string; size?: 24 | 32 | 40; className?: string }) {
  const px = { 24: "size-6 text-xs", 32: "size-8 text-sm", 40: "size-10 text-base" }[size];
  return (
    <span aria-hidden className={cn("grid shrink-0 select-none place-items-center rounded-sm font-semibold", px, `tint-${hashIndex(name, 6)}`, className)}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

const SOURCE_TONE: Record<SourceKind, string> = {
  linkedin: "bg-[#e1ecf7] text-[#1f4460] dark:bg-[#172b3b] dark:text-[#9cc3e0]",
  google: "bg-[#f1e2de] text-[#6b2e24] dark:bg-[#3a1f1a] dark:text-[#e6aaa0]",
  csv: "bg-muted text-muted-foreground",
  x: "bg-[#e7e3f0] text-[#44346b] dark:bg-[#2a2340] dark:text-[#bdb0e3]",
  manual: "bg-muted text-muted-foreground",
  demo: "bg-muted text-muted-foreground",
};

/** A small label for where a person was imported from. */
export function SourceChip({ source, className }: { source: SourceKind; className?: string }) {
  return <span title={SOURCE_LABEL[source]} className={cn("inline-flex h-5 items-center whitespace-nowrap rounded-sm px-1.5 text-xs font-medium", SOURCE_TONE[source], className)}>{SOURCE_SHORT[source]}</span>;
}

/** Heading block at the top of a page. */
export function PageIntro({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="sr-only">{title}</h1>
        {children && <p className="max-w-2xl text-13 text-muted-foreground">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-border-strong px-6 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mt-1 max-w-md text-13 text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-sm border border-border-strong bg-muted px-1 font-mono text-[11px] text-muted-foreground">{children}</kbd>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 text-xl font-semibold tracking-[-0.01em]">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
