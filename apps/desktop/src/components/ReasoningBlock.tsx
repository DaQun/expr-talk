import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** 可折叠的模型思考过程；回复完成后默认收起，流式生成时可保持展开。 */
export function ReasoningBlock({
  reasoning,
  label = "思考过程",
  defaultOpen = false,
}: {
  reasoning: string;
  label?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!reasoning.trim()) return null;
  return (
    <div className="bg-muted/40 mt-1.5 rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-left font-medium"
      >
        <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} aria-hidden />
        {label}
      </button>
      {open && <p className="mt-1.5 opacity-80">{reasoning}</p>}
    </div>
  );
}
