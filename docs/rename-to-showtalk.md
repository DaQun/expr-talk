# ExprTalk → ShowTalk（2026-08-18）

项目已从 **ExprTalk** 更名为 **ShowTalk**。后续改品牌、路径、包名或本机数据时，先读这一节，不要把名字改回去，也不要再按旧 bundle id 写新数据。

## 品牌

| | |
|---|---|
| 产品名 | ShowTalk |
| Slogan | Code is cheap. Show me your talk. |
| 出处 | 反写 Linus Torvalds：「Talk is cheap. Show me the code.」 |
| 常量 | `packages/shared/src/brand.ts`（`APP_NAME` / `APP_SLOGAN` / `APP_BUNDLE_ID`） |

## 名称对照

| 旧 | 新 |
|---|---|
| ExprTalk | ShowTalk |
| `@expr-talk/*` | `@showtalk/*` |
| `expr-talk`（npm 根包） | `showtalk` |
| `github.com/DaQun/expr-talk` | `github.com/DaQun/showtalk` |
| `com.exprtalk.app` | `com.showtalk.app` |
| `expr-talk.sqlite` | `showtalk.sqlite` |
| `EXPR_TALK_ASR_MODEL_DIR` | `SHOWTALK_ASR_MODEL_DIR`（旧名仍可读） |
| `expr-talk:*` localStorage | `showtalk:*` |

本地工作区目录仍可叫 `expr-talk`。**不要擅自改文件夹名。**

旧 GitHub 地址会跳到新仓库，不要再把文档或 remote 指回 `DaQun/expr-talk`。

## 本机数据

当前目录（macOS）：

```text
~/Library/Application Support/com.showtalk.app/
  showtalk.sqlite
  recordings/
  models/
```

旧目录（备份，确认无误后可删）：

```text
~/Library/Application Support/com.exprtalk.app/
```

2026-08-18 已把该机器上的会话、设置、录音、模型软链拷到新目录，并把库里的绝对路径从 `com.exprtalk.app` 改成 `com.showtalk.app`。当时约 61 条会话、133 个录音。

启动桌面端仍会跑一次幂等迁移（`apps/desktop/src-tauri/src/db/legacy.rs`）：

1. 若新目录缺文件，从 `com.exprtalk.app` 补拷（含 `expr-talk.sqlite*` → `showtalk.sqlite*`）。
2. 把库里残留的 `com.exprtalk.app` 路径改成 `com.showtalk.app`。

已存在的新文件不会被旧文件覆盖。

换 bundle id 后，macOS 把 ShowTalk 当成新应用：**麦克风权限不会从 ExprTalk 带过来**。若本地 ASR 没有字幕，先重启桌面端，再在「系统设置 → 隐私与安全性 → 麦克风」里允许 ShowTalk。

## 改名时不要做的事

- 不要把 bundle id 改回 `com.exprtalk.app`，否则会重新写进旧目录。
- 不要只改展示名、不改 `identifier` / 库文件名 / 录音路径。
- 不要删除 `legacy.rs` 里的旧 id，除非确认没有旧目录、也没有旧库要迁。
- 不要重命名当前仓库文件夹，除非用户明确要求。
