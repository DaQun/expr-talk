type Props = {
  label: string;
  value: string | number;
};

export function MetricBadge({ label, value }: Props) {
  return (
    <div className="bg-background rounded-lg border border-border p-3">
      <div className="text-muted-foreground text-[0.72rem] font-medium tracking-wide">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}
