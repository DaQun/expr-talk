import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Home,
  Mic,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("expr-talk:sidebar-collapsed") === "true",
  );

  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem("expr-talk:sidebar-collapsed", String(next));
      return next;
    });
  }

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
    <div
      className={cn(
        "grid min-h-screen bg-background transition-[grid-template-columns] duration-200 md:grid-cols-[216px_minmax(0,1fr)]",
        sidebarCollapsed && "md:grid-cols-[64px_minmax(0,1fr)]",
      )}
    >
      <aside
        className={cn(
          "border-sidebar-border bg-sidebar text-sidebar-foreground sticky top-0 z-10 flex h-auto flex-col gap-4 border-b p-3 md:h-screen md:border-r md:border-b-0 md:p-3",
          sidebarCollapsed && "md:items-center md:px-3",
        )}
      >
        <div
          className={cn(
            "flex w-full items-center justify-between gap-2 px-1 py-0.5",
            sidebarCollapsed && "md:flex-col md:justify-center md:gap-2 md:px-0",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 items-center gap-2.5",
              sidebarCollapsed && "md:justify-center",
            )}
          >
            <div
              className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-md text-sm font-bold"
              aria-hidden
            >
              E
            </div>
            <div className={cn("min-w-0", sidebarCollapsed && "md:hidden")}>
              <div className="text-[0.95rem] font-semibold tracking-tight">
                ExprTalk
              </div>
              <div className="text-muted-foreground text-[0.7rem] tracking-wide">
                本地优先 · 表达训练
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden size-8 shrink-0 rounded-md md:inline-flex"
            aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>

        <Separator className="bg-sidebar-border/80" />

        <nav
          className={cn(
            "flex w-full flex-1 flex-row flex-wrap gap-1 md:flex-col",
            sidebarCollapsed && "md:items-center",
          )}
          aria-label="主导航"
        >
          {recording && (
            <NavLink
              to="/practice"
              className={cn(
                "border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs leading-relaxed",
                sidebarCollapsed && "md:size-10 md:p-0 md:text-[0px]",
              )}
              title="录音正在进行，请回到练习页停止或放弃后再切换页面。"
            >
              <Mic className={cn("hidden size-4", sidebarCollapsed && "md:block")} />
              <span className={cn(sidebarCollapsed && "md:hidden")}>
                录音正在进行。请回到练习页停止或放弃后再切换页面。
              </span>
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
                aria-label={sidebarCollapsed ? link.label : undefined}
                tabIndex={blocked ? -1 : undefined}
                title={sidebarCollapsed ? link.label : undefined}
                onClick={(event) => {
                  if (blocked) event.preventDefault();
                }}
                className={({ isActive }) =>
                  cn(
                    "text-muted-foreground group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    sidebarCollapsed && "md:size-10 md:justify-center md:px-0",
                    "hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground",
                    isActive &&
                      "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
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
                    <span className={cn(sidebarCollapsed && "md:hidden")}>
                      {link.label}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div
          className={cn(
            "text-muted-foreground mt-auto hidden rounded-md border border-sidebar-border/70 bg-sidebar-accent/30 p-3 text-[0.7rem] leading-relaxed md:block",
            sidebarCollapsed && "md:hidden",
          )}
        >
          <div className="text-foreground/80 mb-1 font-medium tracking-wide">
            训练原则
          </div>
          说完就停 · 只改一点 · 马上复练
          <br />
          录音与指标默认留在本机
        </div>
      </aside>

      <main className="relative min-w-0 w-full max-w-[1440px] justify-self-center px-4 py-6 pb-14 md:px-7 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
