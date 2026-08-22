import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** 用于区分不同区域的错误边界（如复盘页） */
  label?: string;
};

type State = {
  error: Error | null;
};

/** 渲染错误边界：页面局部崩溃时展示错误而非整页白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label ?? "app"}]`, error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="bg-destructive/10 text-destructive border-destructive/30 m-4 rounded-lg border px-4 py-3 text-sm">
        <div className="mb-1 font-semibold">页面渲染出错</div>
        <p className="mb-1 break-all whitespace-pre-wrap">{error.message}</p>
        <p className="mb-0 break-all whitespace-pre-wrap text-xs opacity-80">
          {error.stack}
        </p>
      </div>
    );
  }
}