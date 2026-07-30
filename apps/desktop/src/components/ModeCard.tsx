import type { PracticeMode } from "@expr-talk/shared";
import {
  PRACTICE_MODE_BLURBS,
  PRACTICE_MODE_LABELS,
} from "@expr-talk/shared";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
      aria-pressed={selected}
      className="w-full text-left"
    >
      <Card
        className={cn(
          "h-full gap-2 py-4 transition-all duration-200 hover:-translate-y-px hover:border-primary/25",
          selected &&
            "border-primary/50 bg-primary/10 ring-primary/25 shadow-[0_0_0_1px_oklch(0.72_0.11_82_/_18%),0_8px_24px_oklch(0.35_0.03_285_/_8%)] ring-1",
        )}
      >
        <CardHeader className="gap-2 px-4">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm leading-snug font-medium">
              {PRACTICE_MODE_LABELS[mode]}
            </CardTitle>
            <span
              className={cn(
                "border-border grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                selected
                  ? "bg-primary border-primary text-primary-foreground shadow-[0_0_10px_oklch(0.72_0.11_82_/_30%)]"
                  : "text-transparent",
              )}
              aria-hidden
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
          </div>
          <CardDescription className="text-xs leading-snug">
            {PRACTICE_MODE_BLURBS[mode]}
          </CardDescription>
        </CardHeader>
      </Card>
    </button>
  );
}
