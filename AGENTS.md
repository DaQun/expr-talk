# ShowTalk

本地优先的口头表达训练桌面应用。旧名 **ExprTalk**，2026-08-18 已更名。细节见 [`docs/rename-to-showtalk.md`](docs/rename-to-showtalk.md)。

- 产品名：ShowTalk。Slogan：`Code is cheap. Show me your talk.`
- 包名：`@showtalk/*`。GitHub：https://github.com/DaQun/showtalk
- Bundle ID：`com.showtalk.app`。库：`showtalk.sqlite`
- 本机数据：`~/Library/Application Support/com.showtalk.app`
- 工作区目录可以仍叫 `expr-talk`，不要擅自改文件夹名
- 启动时会从 `com.exprtalk.app` / `expr-talk.sqlite` 做幂等迁移（`apps/desktop/src-tauri/src/db/legacy.rs`）
- 品牌文案只改 `packages/shared/src/brand.ts`，不要在页面里写死旧名
