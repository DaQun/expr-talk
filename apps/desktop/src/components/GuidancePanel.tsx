import type { ReactNode } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type GuidanceItem = {
  id: string;
  title: string;
  detail: string;
  severity?: "info" | "warn" | "danger";
  action?: ReactNode;
};

type Props = {
  title?: string;
  items: GuidanceItem[];
};

function severityToVariant(
  severity?: GuidanceItem["severity"],
): "info" | "warning" | "destructive" | "default" {
  if (severity === "danger") return "destructive";
  if (severity === "warn") return "warning";
  if (severity === "info") return "info";
  return "default";
}

export function GuidancePanel({ title = "需要你处理", items }: Props) {
  if (items.length === 0) return null;

  return (
    <Card className="border-primary/25">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {items.map((item) => (
          <Alert key={item.id} variant={severityToVariant(item.severity)}>
            <AlertTitle>{item.title}</AlertTitle>
            <AlertDescription>
              <p>{item.detail}</p>
              {item.action ? (
                <div className="mt-2.5 flex flex-wrap gap-2">{item.action}</div>
              ) : null}
            </AlertDescription>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}

/** 根据练习态推断引导项 */
export function buildPracticeGuidance(input: {
  tauri: boolean;
  recording: boolean;
  hasSubtitle: boolean;
  levelPct: number;
  modelReady: boolean | null;
  modelHint?: string;
  asrStatus?: string | null;
  error?: string | null;
  seconds: number;
}): GuidanceItem[] {
  const items: GuidanceItem[] = [];
  const status = (input.asrStatus ?? "").toLowerCase();

  if (!input.tauri) {
    items.push({
      id: "browser",
      title: "浏览器预览没有本地 ASR",
      detail:
        "实时字幕需要桌面端（npm run tauri:dev）。这里可录音看电平，或粘贴逐字稿分析。",
      severity: "warn",
    });
  }

  if (input.tauri && input.modelReady === false) {
    items.push({
      id: "model",
      title: "本地 ASR 模型未下载",
      detail:
        input.modelHint ||
        "本地模型默认不附带。请到「设置 → 语音识别」下载，或改用百炼/腾讯/火山在线 ASR；也可粘贴逐字稿。",
      severity: "warn",
    });
  }

  if (input.error) {
    const mic =
      /麦克风|getUserMedia|NotAllowed|Permission|permission|超时/i.test(
        input.error,
      );
    items.push({
      id: "error",
      title: mic ? "麦克风权限或采集失败" : "启动失败",
      detail: mic
        ? `系统设置 → 隐私与安全性 → 麦克风，允许 ExprTalk。原始信息：${input.error}`
        : input.error,
      severity: "danger",
    });
  }

  if (
    input.recording &&
    input.seconds >= 8 &&
    !input.hasSubtitle &&
    input.levelPct < 5
  ) {
    items.push({
      id: "silent",
      title: "几乎听不到声音",
      detail:
        "请靠近麦克风说话，或检查是否选错输入设备、系统是否静音。电平条应随说话跳动。",
      severity: "warn",
    });
  }

  if (
    input.recording &&
    input.seconds >= 12 &&
    !input.hasSubtitle &&
    input.levelPct >= 5 &&
    input.tauri
  ) {
    items.push({
      id: "no-asr",
      title: "有声音但还没有字幕",
      detail: status.includes("加载")
        ? "ASR 模型可能仍在加载，再等几秒；若一直没有，重启应用或检查模型目录。"
        : "可先停止，在下方粘贴逐字稿完成分析；或确认 ASR 状态是否报错。",
      severity: "warn",
    });
  }

  if (!input.recording && !input.error && input.tauri && input.modelReady) {
    items.push({
      id: "ready",
      title: "可以开始",
      detail: "点击「开始录音练习」，说完后停止即可看到诊断与复练建议。",
      severity: "info",
    });
  }

  return items;
}

export function buildEmptyTranscriptGuidance(input: {
  hasAudio: boolean;
  modelReady: boolean | null;
}): GuidanceItem[] {
  const items: GuidanceItem[] = [
    {
      id: "empty",
      title: "本轮没有可用逐字稿",
      detail:
        "没有文本就无法做填充词/结构诊断。可以：再录一次、确认麦克风与 ASR，或粘贴逐字稿分析。",
      severity: "warn",
    },
  ];

  if (input.modelReady === false) {
    items.push({
      id: "model",
      title: "本地模型可能未下载",
      detail:
        "到设置页下载本地模型，或切换到在线 ASR（百炼/腾讯/火山）；也可粘贴逐字稿再分析。",
      severity: "warn",
    });
  }

  if (!input.hasAudio) {
    items.push({
      id: "no-audio",
      title: "也没有录音文件",
      detail: "更像是录音未真正开始。请回到练习页重新开始，并允许麦克风权限。",
      severity: "danger",
    });
  }

  return items;
}
