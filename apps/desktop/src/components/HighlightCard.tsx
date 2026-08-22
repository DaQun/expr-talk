import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type HighlightItem = {
  icon?: ReactNode;
  title: string;
  value: string;
  badge?: string;
};

type Props = {
  highlights: HighlightItem[];
};

/** 本次亮点：正向激励卡片，仅在有亮点时渲染。 */
export function HighlightCard({ highlights }: Props) {
  if (highlights.length === 0) return null;
  return (
    <Card className="border-success/30 surface-hero">
      <CardHeader className="pb-2">
        <div className="text-success flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
          <Sparkles className="size-3.5" />
          本次亮点
        </div>
        <CardTitle className="text-lg">值得肯定的表现</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {highlights.map((highlight, index) => (
          <div
            key={`${highlight.title}-${index}`}
            className="bg-success/5 flex flex-col gap-1.5 rounded-lg border border-success/20 px-3.5 py-3"
          >
            <div className="flex items-center gap-2">
              {highlight.icon && (
                <span className="text-success">{highlight.icon}</span>
              )}
              <span className="text-sm font-medium">{highlight.title}</span>
            </div>
            <div className="text-lg font-bold tabular-nums">
              {highlight.value}
            </div>
            {highlight.badge && (
              <Badge variant="success" className="w-fit">
                {highlight.badge}
              </Badge>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}