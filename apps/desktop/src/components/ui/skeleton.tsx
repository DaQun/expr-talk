import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "bg-muted/60 animate-pulse rounded-md border border-border",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
