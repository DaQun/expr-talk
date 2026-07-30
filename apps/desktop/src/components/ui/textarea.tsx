import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-primary/20 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex field-sizing-content min-h-28 w-full rounded-xl border bg-card px-3 py-2 text-sm shadow-none transition-[color,box-shadow,border-color] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
