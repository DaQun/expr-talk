import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      // macOS / WKWebView 默认会把句首字母大写，模型名、URL、Key 等标识符会乱
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary/25 selection:text-foreground border-input flex h-10 w-full min-w-0 rounded-xl border bg-card px-3 py-2 text-sm shadow-none transition-[color,box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-primary/50 focus-visible:ring-primary/20 focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
