import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string | number;
  emphasize?: boolean;
};

export function MetricBadge({ label, value, emphasize }: Props) {
  return (
    <div
      className={cn(
        "bg-background rounded-lg border p-3",
        emphasize ? "border-primary/40 bg-primary/5" : "border-border",
      )}
    >
      <div className="text-muted-foreground text-[0.72rem] font-medium tracking-wide">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-semibold tracking-tight tabular-nums",
          emphasize ? "text-2xl" : "text-xl",
        )}
      >
        {value}
      </div>
    </div>
  );
}
