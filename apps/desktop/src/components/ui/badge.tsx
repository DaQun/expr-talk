import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium tracking-wide w-fit whitespace-nowrap shrink-0 gap-1 transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-primary/35 bg-primary/18 text-[oklch(0.42_0.08_75)]",
        secondary:
          "border-border bg-secondary text-muted-foreground",
        outline:
          "border-border bg-card text-muted-foreground",
        success:
          "border-success/25 bg-success/10 text-success",
        warning:
          "border-warning/30 bg-warning/12 text-warning-foreground",
        destructive:
          "border-destructive/25 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
