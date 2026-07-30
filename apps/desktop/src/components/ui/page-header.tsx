import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-[1.65rem] font-semibold tracking-tight">{title}</h1>
        {description ? (
          <div className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            {description}
          </div>
        ) : null}
      </div>
      {action}
    </header>
  );
}
