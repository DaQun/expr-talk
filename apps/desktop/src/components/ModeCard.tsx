import type { PracticeMode } from "@showtalk/shared";
import {
  PRACTICE_MODE_BLURBS,
  PRACTICE_MODE_LABELS,
} from "@showtalk/shared";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  mode: PracticeMode;
  selected: boolean;
  onSelect: (mode: PracticeMode) => void;
};

export function ModeCard({ mode, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      role="radio"
      aria-checked={selected}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_1.25rem] items-center gap-3 rounded-md border border-border px-3.5 py-3 text-left transition-colors outline-none hover:border-primary/30 hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/40",
        selected && "border-primary/45 bg-primary/10",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-snug">
          {PRACTICE_MODE_LABELS[mode]}
        </span>
        <span className="text-muted-foreground mt-1 block text-xs leading-snug">
          {PRACTICE_MODE_BLURBS[mode]}
        </span>
      </span>
      <span
        className={cn(
          "border-border grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
          selected
            ? "bg-primary border-primary text-primary-foreground"
            : "text-transparent",
        )}
        aria-hidden
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </button>
  );
}
