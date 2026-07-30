import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Home,
  Mic,
  History,
  UserRound,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useSessionStore } from "@/state/sessionStore";

const links = [
  { to: "/", label: "首页", end: true, icon: Home },
  { to: "/practice", label: "练习", icon: Mic },
  { to: "/history", label: "历史", icon: History },
  { to: "/profile", label: "画像", icon: UserRound },
  { to: "/settings", label: "设置", icon: Settings },
] as const;

export function Layout() {
  const recording = useSessionStore((s) => s.current?.status === "recording");

  useEffect(() => {
    if (!recording) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);

  return (
    <div className="grid min-h-screen md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="border-sidebar-border bg-sidebar/90 text-sidebar-foreground sticky top-0 z-10 flex h-auto flex-col gap-5 border-b p-4 backdrop-blur-xl md:h-screen md:border-r md:border-b-0 md:p-5">
        <div className="flex items-center gap-3 px-1 py-0.5">
          <div
            className="from-primary via-primary to-primary/80 text-primary-foreground grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-sm font-bold shadow-[0_4px_14px_oklch(0.72_0.11_82_/_30%)]"
            aria-hidden
          >
            E
          </div>
          <div className="min-w-0">
            <div className="text-[0.95rem] font-semibold tracking-tight">
              ExprTalk
            </div>
            <div className="text-muted-foreground text-[0.7rem] tracking-wide">
              本地优先 · 表达训练
            </div>
          </div>
        </div>

        <Separator className="bg-sidebar-border/80" />

        <nav
          className="flex flex-1 flex-row flex-wrap gap-1 md:flex-col"
          aria-label="主导航"
        >
          {recording && (
            <NavLink
              to="/practice"
              className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs leading-relaxed"
            >
              录音正在进行。请回到练习页停止或放弃后再切换页面。
            </NavLink>
          )}
          {links.map((link) => {
            const Icon = link.icon;
            const blocked = recording && link.to !== "/practice";
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={"end" in link ? link.end : false}
                aria-disabled={blocked}
                tabIndex={blocked ? -1 : undefined}
                onClick={(event) => {
                  if (blocked) event.preventDefault();
                }}
                className={({ isActive }) =>
                  cn(
                    "text-muted-foreground group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-all duration-200",
                    "hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground",
                    isActive &&
                      "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-[inset_0_0_0_1px_oklch(0.72_0.11_82_/_22%)]",
                    blocked && "pointer-events-none opacity-40",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span
                        className="bg-primary absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full"
                        aria-hidden
                      />
                    )}
                    <Icon
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        isActive ? "text-primary" : "opacity-80",
                      )}
                      aria-hidden
                    />
                    {link.label}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="text-muted-foreground mt-auto hidden rounded-xl border border-sidebar-border/70 bg-sidebar-accent/30 p-3.5 text-[0.7rem] leading-relaxed md:block">
          <div className="text-foreground/80 mb-1 font-medium tracking-wide">
            训练原则
          </div>
          说完就停 · 只改一点 · 马上复练
          <br />
          录音与指标默认留在本机
        </div>
      </aside>

      <main className="relative min-w-0 w-full max-w-5xl px-4 py-6 pb-14 md:px-8 md:py-9">
        <Outlet />
      </main>
    </div>
  );
}
