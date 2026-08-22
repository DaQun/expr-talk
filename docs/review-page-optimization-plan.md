# 复盘页面全面优化实施计划

## Context

当前复盘页面 (`ReviewPage.tsx`) 存在以下问题：
1. **信息密度过高**：用户需要大量滚动，关键指标不够突出
2. **缺少趋势数据**：只能看单次报告或相邻两次对比，无法看到长期进步
3. **对比数据埋得太深**：复练对比是核心价值但默认折叠
4. **折叠项过多**：至少8处折叠/展开，导航困难
5. **缺少视觉化**：纯文本和数字，缺乏图表支持
6. **成功感不足**：只有问题导向，缺少正向激励

用户要求实现所有优化建议，包括数据指标优化、布局重构、UX改进和数据可视化增强。

## 已探索的关键信息

### 技术栈
- **UI组件**: shadcn/ui (Radix UI primitives) - Card, Badge, Button, Progress等
- **图表库**: **未安装** - 需要添加 recharts
- **现有组件**:
  - `ComparisonCard`: 复练对比展示
  - `ConversationTimeline`: 辩论/费曼多轮对话
  - `GuidancePanel`: 引导面板
  - UI基础组件齐全，但**缺少 Tabs 组件**

### 数据结构
- `UserProfile`: 包含趋势数据 (`trends[]`)、反复问题 (`recurringIssues[]`)、模式能力 (`modeAbilities[]`)
- `StructuredReport`: 当前报告结构，包含 `dimensionReviews`, `scores`, `taskChecks` 等
- `AttemptComparison`: 复练对比数据
- 历史数据API: `api.listHistory()`, `api.getProfile()` 可获取多次练习数据

### 现有模式
- 折叠/展开: 使用 `useState` + `ChevronDown/Up` 图标
- 数据卡片: Grid布局 + `bg-card` 背景
- 状态徽章: `<Badge variant="success|warning|secondary">`
- 进度条: `<Progress value={score} />` (0-100)

## 探索发现汇总

### ✅ 探索1: UI组件和图表库 (已完成)

**关键发现**:
1. **没有任何图表库** - 需要添加 recharts 或使用原生 SVG
2. **缺少 Tabs 组件** - 需要添加 `@radix-ui/react-tabs`
3. **缺少 Tooltip 组件** - 需要添加 `@radix-ui/react-tooltip`
4. **已有完整 UI 基础**:
   - Card, Badge, Progress, Button 等齐全
   - lucide-react 图标库 (ArrowUp/Down, Chevron等)
   - 已定义 chart 颜色变量 `--chart-1` 到 `--chart-5`
5. **折叠模式**: 多处使用 `useState` + ChevronDown/Up 图标
6. **设计系统**: Tailwind CSS 4, oklch 颜色空间, 统一圆角/间距

**推荐方案**: 
- 图表: recharts (React友好) 或原生SVG (零依赖)
- 考虑项目"本地优先"理念，优先考虑 recharts 的轻量使用

### ✅ 探索2: 历史数据和API (已完成)

**关键发现**:
1. **历史数据API**: `api.listHistory(query)` 支持分页、搜索、按模式过滤
2. **用户档案**: `api.getProfile()` 自动聚合所有历史数据，包含：
   - `trends[]`: 指标变化趋势（对比早期3次 vs 最近3次）
   - `recurringIssues[]`: 反复问题追踪，带趋势判断（improving/stable/worsening）
   - `modeAbilities[]`: 分模式能力统计
   - `strength`: 最强维度
   - `focus`: 需重点改进的问题
3. **数据成熟度**:
   - < 3次：insufficient (数据不足)
   - 3-5次：preliminary (初步画像)
   - ≥ 6次：established (稳定画像，可用趋势分析)
4. **存储架构**: SQLite(桌面端) + 内存(Web端) 双层
5. **已有趋势功能**: ProfilePage 使用 ArrowUp/Down + 百分比展示趋势

**可用数据**:
- `profileQuery.data.trends` - 多维度趋势（baseline, recent, delta, improved）
- `profileQuery.data.recurringIssues` - 反复问题列表（count, sessionRate, trend）
- 历史会话列表 - 最近 N 次的完整报告和指标

### ✅ 探索3: 对比和反馈机制 (已完成)

**关键发现**:
1. **ComparisonCard 实现**:
   - 使用 `Delta` 子组件展示 before → after → delta
   - 支持三种判断逻辑: "lower" (越低越好), "higher" (越高越好), "target-range" (区间最优)
   - 颜色编码: success (绿)、destructive (红)、muted (灰)
2. **Badge 系统**: 6种变体 - default, secondary, outline, success, warning, destructive
3. **现有激励机制**:
   - 对比摘要条（顶部）
   - 反复问题累计次数提示
   - 成功标准达成列表
4. **缺失的激励**:
   - ❌ 无连续进步庆祝
   - ❌ 无里程碑徽章/成就系统
   - ❌ 无趋势可视化
   - ❌ 弱个性化鼓励
5. **Tooltip**: 项目使用原生 `title` 属性，**无自定义 Tooltip 组件**
6. **音频播放**: 使用原生 `<audio>` 控件 + Tauri `convertFileSrc()`
7. **逐字稿高亮**: `highlightTranscript()` 函数，标黄可点击跳转到改写建议
8. **引导系统**: `GuidancePanel` 根据状态智能推断问题并提供解决方案

## 技术决策

### 图表库选择: recharts
**理由**:
- React 友好，声明式 API
- 支持响应式和主题定制
- 文件大小适中 (~400KB)
- 项目已有 `--chart-1` 到 `--chart-5` 颜色变量，可直接使用

**备选方案**:
- 原生 SVG: 零依赖但需手写大量代码
- 推荐使用 recharts，符合项目快速迭代需求

### Tooltip 实现: 添加 Radix UI Tooltip
**理由**:
- 项目目前只用原生 `title` 属性
- 需要更丰富的样式和内容支持（如代码示例、多行文本）
- 与现有 Radix UI 组件（Select, Switch等）一致

### 布局方案: Tab 模式
**理由**:
- 减少滚动距离，信息分层清晰
- 符合"总览 → 明细 → 原始材料"的用户心智模型
- 可独立优化每个 Tab 的加载性能

### 渐进式实施策略
不是"全部重写"，而是**在现有基础上增强**:
1. 保留所有现有功能和数据结构
2. 新增 Tab 布局作为主导航
3. 复用现有组件（ComparisonCard, ConversationTimeline 等）
4. 向后兼容旧报告格式

### Phase 1: 添加依赖和基础组件

**新增依赖** (修改 `apps/desktop/package.json`):
```json
{
  "dependencies": {
    "recharts": "^2.12.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-tooltip": "^1.1.0"
  }
}
```

**新建组件**:

1. **Tabs 组件** - `apps/desktop/src/components/ui/tabs.tsx`
   ```tsx
   // 包装 @radix-ui/react-tabs
   // 导出: Tabs, TabsList, TabsTrigger, TabsContent
   // 样式: 与现有 toggle-group 风格一致
   ```

2. **Tooltip 组件** - `apps/desktop/src/components/ui/tooltip.tsx`
   ```tsx
   // 包装 @radix-ui/react-tooltip
   // 导出: Tooltip, TooltipTrigger, TooltipContent, TooltipProvider
   // 样式: 使用 popover 颜色变量
   ```

3. **趋势折线图** - `apps/desktop/src/components/TrendChart.tsx`
   ```tsx
   // Props: { data: Array<{round: number, score: number}>, label: string }
   // 使用 recharts: LineChart + Line + XAxis + YAxis + Tooltip
   // 颜色: 使用 --chart-1 (primary green)
   // 尺寸: 默认高度 200px, 响应式宽度
   ```

4. **五维雷达图** - `apps/desktop/src/components/RadarChart.tsx`
   ```tsx
   // Props: { dimensions: Array<{label: string, score: number}> }
   // 使用 recharts: RadarChart + PolarGrid + PolarAngleAxis + Radar
   // 颜色: 使用 --chart-1, 填充半透明
   // 尺寸: 固定 300x300 或响应式
   ```

5. **亮点卡片** - `apps/desktop/src/components/HighlightCard.tsx`
   ```tsx
   // Props: { title: string, value: string | number, badge?: string, icon?: ReactNode }
   // 样式: 使用 success 颜色系统
   // 图标: Sparkles, Trophy, TrendingUp 等
   ```

6. **Diff 文本组件** - `apps/desktop/src/components/DiffText.tsx`
   ```tsx
   // Props: { original: string, rewritten: string }
   // 渲染: <del>原文</del> <ins>改写</ins>
   // 样式: del 删除线+destructive色, ins 高亮+success色
   ```

### Phase 2: 重构 ReviewPage 布局

**新布局结构** (采用Tab模式):
```
[Page Header]
[Badges: 模式、报告来源、轮次]
[复练对比摘要条] (如果有对比数据，始终可见)

[Tabs]
├─ 总览 (默认Tab)
│  ├─ 下一步行动卡片 (hero card)
│  ├─ 本次亮点 (新增)
│  ├─ 成绩概览 (综合分大、核心指标)
│  └─ 近期趋势 (折线图，最近5次)
├─ 诊断明细
│  ├─ 五维雷达图 (新增)
│  ├─ 五维详情 (可展开)
│  └─ 本地口语指标
├─ 改写建议
│  ├─ 关键表达对照
│  └─ 整篇逻辑审查
└─ 原始材料
   ├─ 对话时间线
   ├─ 逐字稿
   └─ 录音
```

### Phase 3: 数据指标优化

**3.1 突出综合分**:
```tsx
// 在"总览" Tab 最上方，独立卡片
<Card className="surface-hero">
  <CardContent className="flex items-center justify-between py-6">
    <div>
      <div className="text-muted-foreground text-sm">综合分</div>
      <div className="text-5xl font-bold tabular-nums">{overallScore}</div>
      {weakestDimension && (
        <div className="text-muted-foreground mt-2 text-sm">
          最弱: {weakestDimension.label} {weakestDimension.score}
        </div>
      )}
    </div>
    <Progress value={overallScore} className="h-3 w-32" />
  </CardContent>
</Card>
```

**3.2 前置对比数据**:
```tsx
// 如果有 comparison，在综合分旁边显示趋势
{cmp && (
  <div className="flex items-center gap-2">
    {cmp.improved ? (
      <ArrowUp className="text-success size-5" />
    ) : (
      <ArrowDown className="text-destructive size-5" />
    )}
    <span className={cn(
      "text-sm font-medium",
      cmp.improved ? "text-success" : "text-destructive"
    )}>
      {cmp.improved ? "本轮进步" : "待改善"}
    </span>
  </div>
)}
```

**3.3 趋势图表实现**:
```tsx
// 获取历史数据
const historyQuery = useQuery({
  queryKey: ["session-history", current?.id],
  queryFn: async () => {
    const sessions = await api.listHistory({ limit: 10 });
    return sessions
      .filter(s => s.report && s.metrics)
      .slice(0, 10)
      .reverse(); // 从旧到新排序
  },
  enabled: Boolean(current?.id && report),
});

// 转换为图表数据
const trendData = historyQuery.data?.map((s, idx) => ({
  round: idx + 1,
  overall: calculateOverallScore(s.report.scores),
  fillerRate: s.metrics.fillerCount / Math.max(1, s.metrics.totalChars) * 100,
  pace: s.metrics.wordsPerMinute,
})) ?? [];

// 渲染趋势图
<TrendChart
  data={trendData}
  lines={[
    { dataKey: "overall", name: "综合分", color: "var(--chart-1)" },
    { dataKey: "fillerRate", name: "填充词率", color: "var(--chart-2)" },
  ]}
/>
```

**3.4 Tooltip 增强**:
```tsx
<Tooltip>
  <TooltipTrigger>
    <Badge variant={signalStatusVariant(signal.status)}>
      {signal.status}
    </Badge>
  </TooltipTrigger>
  <TooltipContent>
    <p className="text-xs">{signal.detail}</p>
  </TooltipContent>
</Tooltip>
```

### Phase 4: 用户体验增强

**4.1 本次亮点卡片** (新增):
```tsx
// 在"总览" Tab 的"下一步行动"之前插入
function buildHighlights(report, comparison, profile) {
  const highlights = [];
  
  // 1. 找到得分最高的维度
  const topDimension = scoredDimensions
    .sort((a, b) => b.score - a.score)[0];
  if (topDimension && topDimension.score >= 80) {
    highlights.push({
      icon: <Trophy className="size-5" />,
      title: "本次亮点",
      value: `${topDimension.label} ${topDimension.score}分`,
      badge: "优秀表现",
    });
  }
  
  // 2. 找到进步最大的指标
  if (comparison && comparison.improved) {
    const maxDelta = Math.max(
      ...Object.values(comparison.deltas).filter(d => typeof d === 'number')
    );
    highlights.push({
      icon: <TrendingUp className="size-5" />,
      title: "最大进步",
      value: `+${maxDelta.toFixed(1)}`,
      badge: "本轮突破",
    });
  }
  
  // 3. 历史最佳标记
  const historicalBest = checkHistoricalBest(report, profile);
  if (historicalBest) {
    highlights.push({
      icon: <Sparkles className="size-5" />,
      title: "创历史新高",
      value: historicalBest.label,
      badge: "里程碑",
    });
  }
  
  return highlights;
}

<HighlightCard highlights={highlights} />
```

**4.2 反复问题进度条**:
```tsx
{recurringIssue && recurringIssue.count >= 2 && (
  <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-3">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-medium">改进进度</span>
      <span className="text-xs text-muted-foreground">
        {recurringIssue.count} / 10 次练习
      </span>
    </div>
    <Progress 
      value={(recurringIssue.count / 10) * 100} 
      className="h-2"
    />
    {recurringIssue.trend === "improving" && (
      <p className="text-xs text-success mt-1.5">
        ✓ 正在改善，继续保持
      </p>
    )}
  </div>
)}
```

**4.3 改写对比 Diff 样式**:
```tsx
// DiffText 组件
export function DiffText({ original, rewritten }: Props) {
  const changes = computeDiff(original, rewritten);
  
  return (
    <div className="space-y-2">
      {changes.map((change, idx) => (
        <span key={idx}>
          {change.type === 'delete' && (
            <del className="text-destructive/80 decoration-destructive">
              {change.text}
            </del>
          )}
          {change.type === 'insert' && (
            <ins className="text-success bg-success/10 no-underline font-medium px-0.5 rounded">
              {change.text}
            </ins>
          )}
          {change.type === 'equal' && change.text}
        </span>
      ))}
    </div>
  );
}

// 使用简单的字符串 diff 算法或库 (如 diff-match-patch)
```

**4.4 数据解读 Tooltip**:
```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Badge variant={signalStatusVariant(signal.status)}>
        {signal.status}
      </Badge>
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-xs">
      <p className="text-xs leading-relaxed">{signal.detail}</p>
      {signal.id === 'pace' && (
        <p className="text-xs text-muted-foreground mt-1">
          本模式参考区间: {modePaceRange[0]}-{modePaceRange[1]} 字/分
        </p>
      )}
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

### Phase 5: 数据可视化

**5.1 五维雷达图实现**:
```tsx
// RadarChart.tsx
import { 
  RadarChart, Radar, PolarGrid, PolarAngleAxis, 
  ResponsiveContainer 
} from 'recharts';

export function DimensionRadarChart({ dimensions }: Props) {
  // dimensions: [{label: "内容质量", score: 85}, ...]
  
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={dimensions}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis 
          dataKey="label" 
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
        />
        <Radar 
          name="本次得分" 
          dataKey="score" 
          stroke="hsl(var(--chart-1))"
          fill="hsl(var(--chart-1))"
          fillOpacity={0.3}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
```

**5.2 趋势折线图实现**:
```tsx
// TrendChart.tsx
import { 
  LineChart, Line, XAxis, YAxis, Tooltip, 
  ResponsiveContainer, Legend, CartesianGrid 
} from 'recharts';

export function TrendLineChart({ data, lines }: Props) {
  // data: [{round: 1, overall: 75, fillerRate: 3.2}, ...]
  // lines: [{dataKey: "overall", name: "综合分", color: "var(--chart-1)"}, ...]
  
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid 
          strokeDasharray="3 3" 
          stroke="hsl(var(--border))" 
        />
        <XAxis 
          dataKey="round" 
          label={{ value: '练习次数', position: 'insideBottom', offset: -5 }}
          tick={{ fill: 'hsl(var(--muted-foreground))' }}
        />
        <YAxis 
          tick={{ fill: 'hsl(var(--muted-foreground))' }}
        />
        <Tooltip 
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 'var(--radius)',
          }}
        />
        <Legend />
        {lines.map(line => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.color}
            strokeWidth={2}
            dot={{ fill: line.color, r: 4 }}
            activeDot={{ r: 6 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

**5.3 对比百分比变化**:
```tsx
// 在 Delta 组件中增加百分比显示
function formatPercentageChange(before: number, after: number): string {
  if (before === 0) return "+∞";
  const change = ((after - before) / before) * 100;
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(0)}%`;
}

// 显示
<div className="flex items-center gap-2">
  <span className="text-lg font-semibold">{sign}</span>
  <span className="text-xs text-muted-foreground">
    ({formatPercentageChange(before, after)})
  </span>
</div>
```

### Phase 6: 减少折叠层级与 Tab 导航

**新的信息架构**:

```
ReviewPage
├─ [Header: 标题、模式徽章、重新评审按钮]
├─ [对比摘要条] (如有对比数据，始终显示)
└─ [Tabs]
    ├─ 总览 (default)
    │   ├─ 本次亮点 ✨ (新增，默认展开)
    │   ├─ 下一步行动 (已有，默认展开)
    │   ├─ 成绩概览 (已有，重新布局)
    │   │   ├─ 综合分大卡片 (突出显示)
    │   │   ├─ 核心指标网格 (任务完成、语速、填充词)
    │   │   └─ [展开] 更多口语指标
    │   └─ 近期趋势 📈 (新增，默认展开)
    │       └─ 折线图 (最近5-10次)
    ├─ 诊断明细
    │   ├─ 五维雷达图 🕸️ (新增，默认展开)
    │   ├─ 五维详情 (已有，可逐项展开)
    │   │   └─ 默认展开最弱维度
    │   └─ 任务清单 (如有)
    ├─ 改写建议
    │   ├─ 关键表达对照 (已有，使用新的 Diff 样式)
    │   │   └─ 默认展示 3 条，[展开] 查看更多
    │   └─ [折叠] 整篇逻辑审查
    └─ 原始材料
        ├─ 对话时间线 (如有，已有组件)
        ├─ 整篇逐字稿 (高亮可跳转)
        └─ 录音素材
```

**Tab 实现**:
```tsx
<Tabs defaultValue="overview" className="w-full">
  <TabsList className="grid w-full grid-cols-4">
    <TabsTrigger value="overview">总览</TabsTrigger>
    <TabsTrigger value="details">诊断明细</TabsTrigger>
    <TabsTrigger value="feedback">改写建议</TabsTrigger>
    <TabsTrigger value="materials">原始材料</TabsTrigger>
  </TabsList>
  
  <TabsContent value="overview">
    {/* 亮点、下一步、成绩、趋势 */}
  </TabsContent>
  
  <TabsContent value="details">
    {/* 雷达图、五维详情 */}
  </TabsContent>
  
  <TabsContent value="feedback">
    {/* 改写对照、逻辑审查 */}
  </TabsContent>
  
  <TabsContent value="materials">
    {/* 时间线、逐字稿、录音 */}
  </TabsContent>
</Tabs>
```

**折叠项优化**:
- ✅ 默认展开: 亮点、下一步、综合分、雷达图、趋势图
- ✅ Tab 隔离: 改写建议、原始材料各自独立 Tab
- 🔽 保留折叠: 次要问题、更多口语指标、整篇逻辑、五维中的非最弱项
- ❌ 移除折叠: "查看对比详情"改为直接在"总览"中嵌入简化版

### 关键文件修改清单

**核心修改**:
1. `apps/desktop/src/pages/ReviewPage.tsx` - **主要重构文件** (约 1700 行)
   - 添加 Tabs 导航结构
   - 重组组件布局（4个 TabsContent）
   - 集成趋势数据查询
   - 添加亮点卡片逻辑
   - 改写 diff 样式展示

**新增 UI 基础组件**:
2. `apps/desktop/src/components/ui/tabs.tsx` - Radix UI Tabs 包装
3. `apps/desktop/src/components/ui/tooltip.tsx` - Radix UI Tooltip 包装

**新增数据可视化组件**:
4. `apps/desktop/src/components/charts/TrendLineChart.tsx` - 趋势折线图
5. `apps/desktop/src/components/charts/DimensionRadarChart.tsx` - 五维雷达图

**新增业务组件**:
6. `apps/desktop/src/components/HighlightCard.tsx` - 亮点展示卡片
7. `apps/desktop/src/components/DiffText.tsx` - 改写文本对比（diff样式）

**工具函数**:
8. `apps/desktop/src/utils/chartHelpers.ts` - 图表数据转换工具
   - `buildTrendData()` - 从历史会话提取趋势数据
   - `calculateOverallScore()` - 计算综合分
   - `formatPercentageChange()` - 格式化百分比变化
   - `checkHistoricalBest()` - 检查是否创历史最佳

**依赖更新**:
9. `apps/desktop/package.json` - 添加依赖
   ```json
   {
     "recharts": "^2.12.0",
     "@radix-ui/react-tabs": "^1.1.0",
     "@radix-ui/react-tooltip": "^1.1.0"
   }
   ```

**类型定义** (如需要):
10. `packages/shared/src/highlight.ts` - 亮点数据类型定义

**总计**: 约 10 个文件修改/新增

## 实施步骤详细顺序

### Step 1: 环境准备 (5分钟)
```bash
cd apps/desktop
npm install recharts @radix-ui/react-tabs @radix-ui/react-tooltip
npm run typecheck  # 确认无依赖冲突
```

### Step 2: 基础 UI 组件 (15分钟)
1. 创建 `components/ui/tabs.tsx` - 复制 shadcn/ui tabs 模板
2. 创建 `components/ui/tooltip.tsx` - 复制 shadcn/ui tooltip 模板
3. 测试组件：创建简单测试页面确认样式正常

### Step 3: 图表组件 (30分钟)
1. 创建 `components/charts/TrendLineChart.tsx`
   - 实现 recharts LineChart 包装
   - 配置主题颜色（使用 CSS 变量）
   - 添加响应式容器
2. 创建 `components/charts/DimensionRadarChart.tsx`
   - 实现 recharts RadarChart 包装
   - 配置半透明填充
3. 测试：使用假数据验证渲染

### Step 4: 工具函数 (20分钟)
创建 `utils/chartHelpers.ts`:
```typescript
export function buildTrendData(sessions: TrainingSession[]) {
  // 提取最近 10 次有效会话
  // 计算每次的综合分、填充词率等
  // 返回图表数据格式
}

export function calculateOverallScore(scores: Partial<Record<ScoreDimension, number>>) {
  // 计算综合分
}

export function checkHistoricalBest(
  currentReport: StructuredReport,
  profile: UserProfile
) {
  // 检查是否创历史最佳
}

export function formatPercentageChange(before: number, after: number) {
  // 格式化百分比变化
}
```

### Step 5: 业务组件 (25分钟)
1. 创建 `components/HighlightCard.tsx`
   - Props: `highlights[]`
   - 样式：success 色系
2. 创建 `components/DiffText.tsx`
   - 使用简单 diff 算法（或 diff-match-patch 库）
   - `<del>` 和 `<ins>` 样式

### Step 6: ReviewPage 重构 - 数据层 (30分钟)
在 `ReviewPage.tsx` 中添加：
1. 历史数据查询 hook
2. 趋势数据计算逻辑
3. 亮点识别逻辑
4. 保留所有现有数据处理逻辑

### Step 7: ReviewPage 重构 - 布局层 (45分钟)
1. 添加 Tabs 结构
2. 重新组织现有内容到 4 个 TabsContent
3. 保持所有现有组件的引用（ComparisonCard, ConversationTimeline 等）
4. 不删除任何现有功能

### Step 8: 总览 Tab 优化 (30分钟)
1. 添加"本次亮点"卡片
2. 重构"成绩概览"：突出综合分
3. 添加趋势折线图
4. 集成 Tooltip

### Step 9: 诊断明细 Tab 优化 (20分钟)
1. 添加五维雷达图
2. 调整五维详情布局
3. 默认展开最弱维度

### Step 10: 改写建议 Tab 优化 (20分钟)
1. 应用 DiffText 组件
2. 调整布局使对比更清晰

### Step 11: 原始材料 Tab (10分钟)
1. 迁移现有的时间线、逐字稿、录音模块
2. 保持所有交互功能

### Step 12: 测试与调试 (60分钟)
1. 功能测试（按验证计划）
2. 视觉调整
3. 响应式测试
4. 边界情况测试

### Step 13: 性能优化 (可选，15分钟)
1. 添加图表懒加载
2. 优化历史数据查询
3. 使用 React.memo 包装图表组件

**总预计时间**: 约 4-5 小时

---

## 实施优先级与分阶段策略

如果时间有限，可以分阶段实施：

### 阶段 1: 核心布局优化 (P0, 约2小时)
- ✅ 添加依赖
- ✅ 创建 Tabs, Tooltip 组件
- ✅ 重构 ReviewPage 为 Tab 布局
- ✅ 突出综合分视觉层级
- ✅ 前置对比数据

**产出**: Tab 导航可用，核心信息更清晰

### 阶段 2: 数据可视化 (P1, 约1.5小时)
- ✅ 添加趋势折线图
- ✅ 添加五维雷达图
- ✅ 添加 Tooltip 解释

**产出**: 趋势和诊断可视化

### 阶段 3: UX 增强 (P1, 约1.5小时)
- ✅ 添加"本次亮点"卡片
- ✅ 改写对比用 diff 样式
- ✅ 反复问题进度条

**产出**: 更好的用户激励和反馈

### 阶段 4: 锦上添花 (P2, 可选)
- ⏳ 智能练习推荐
- ⏳ 徽章/成就系统
- ⏳ 更多图表类型

---

## 验证计划

### 1. 功能验证

**场景1: 首次练习（无历史数据）**
- [ ] 创建一个新练习并生成报告
- [ ] 确认"总览" Tab 正常显示（无趋势图）
- [ ] 确认"诊断明细"中雷达图渲染正常
- [ ] 确认无崩溃或数据缺失错误

**场景2: 有历史数据（3-5次练习）**
- [ ] 完成 3 次练习
- [ ] 确认趋势图显示前 3 次数据
- [ ] 确认 UserProfile 显示为 "preliminary" 成熟度
- [ ] 确认反复问题列表正常

**场景3: 复练对比**
- [ ] 进行一次复练（retry）
- [ ] 确认对比摘要条显示在顶部
- [ ] 确认 Delta 组件显示正确的进步/退步状态
- [ ] 确认"本次亮点"卡片识别进步指标

**场景4: 成熟用户（≥6次练习）**
- [ ] 完成 6+ 次练习
- [ ] 确认趋势图显示完整数据
- [ ] 确认趋势线平滑且正确
- [ ] 确认历史最佳标记功能

**场景5: Tab 切换**
- [ ] 测试 4 个 Tab 的切换流畅性
- [ ] 确认每个 Tab 内容独立加载
- [ ] 确认切换不丢失状态

### 2. 视觉验证

**响应式布局**:
- [ ] 测试 sm 屏幕 (640px) - Tab 列表应可滚动
- [ ] 测试 md 屏幕 (768px) - 网格布局正常
- [ ] 测试 lg 屏幕 (1024px) - 所有组件宽度合理
- [ ] 测试超宽屏 (>1920px) - 内容不过度拉伸

**深色模式** (如果项目支持):
- [ ] 图表颜色在深色模式下清晰可见
- [ ] 所有 Badge 和状态指示器正常
- [ ] Tooltip 背景色正确

**图表主题一致性**:
- [ ] 图表颜色使用 `--chart-1` 到 `--chart-5`
- [ ] 轴标签、网格线颜色与设计系统一致
- [ ] 字体与页面其他部分匹配

### 3. 性能验证

**数据查询性能**:
- [ ] `api.listHistory()` 查询时间 < 500ms
- [ ] `api.getProfile()` 计算时间 < 300ms
- [ ] 图表渲染时间 < 100ms

**渲染性能**:
- [ ] 页面首次加载时间 < 2s
- [ ] Tab 切换响应时间 < 200ms
- [ ] 无明显卡顿或白屏

**内存占用**:
- [ ] 长时间使用不导致内存泄漏
- [ ] 图表数据缓存合理

### 4. 边界情况

**数据缺失**:
- [ ] 无 `dimensionReviews` (旧报告) - 应降级到 `scores` 聚合
- [ ] 无 `comparison` - 对比区域不显示
- [ ] 无 `metrics` - 趋势图显示"数据不足"
- [ ] 只有 1-2 次练习 - 趋势图显示单点或简单线段

**极端数值**:
- [ ] 综合分为 0 或 100
- [ ] 某维度缺少数据
- [ ] 历史会话超过 100 次

**错误处理**:
- [ ] API 查询失败时的友好提示
- [ ] 图表数据格式错误时的降级显示
- [ ] Tooltip 内容超长时的截断

### 5. 交互验证

**Tooltip 功能**:
- [ ] 鼠标悬停显示 Tooltip
- [ ] Tooltip 内容正确且格式良好
- [ ] 移动端点击显示 Tooltip

**逐字稿高亮跳转**:
- [ ] 点击高亮句子跳转到对应改写建议
- [ ] 滚动位置准确（scroll-into-view）
- [ ] 高亮样式清晰可见

**折叠/展开**:
- [ ] "更多口语指标"展开/收起正常
- [ ] "次要问题"展开/收起正常
- [ ] 五维度逐项展开正常

### 6. 向后兼容性

**旧数据格式**:
- [ ] 加载 schema v3 报告不报错
- [ ] 缺少 `dimensionReviews` 时降级处理
- [ ] 缺少 `taskChecks` 时正常显示

**旧路由**:
- [ ] `/review/:sessionId` 仍然可访问
- [ ] URL 参数正确解析

### 验证工具

**开发工具**:
```bash
# 运行类型检查
npm run typecheck

# 运行测试（如有）
npm test

# 构建检查
npm run build
```

**手动测试清单**:
- 创建测试账号，模拟新用户到成熟用户的完整旅程
- 准备多种练习场景（自由发挥、口播、辩论、费曼）
- 记录每个场景的截图和交互视频

**性能工具**:
- Chrome DevTools Performance tab
- React DevTools Profiler
- Lighthouse (如果是 Web 端)

## 注意事项与风险控制

### 1. 向后兼容性（关键）

**问题**: 旧报告可能缺少新字段
**方案**:
```typescript
// 降级处理示例
const dimensionItems = DIMENSION_ORDER.flatMap((key) => {
  const review = report.dimensionReviews?.[key];
  const fallbackScore = fallbackDimensionScores[key]; // 从旧 scores 聚合
  
  // 缺少数据时优雅降级
  if (!review && fallbackScore == null) return [];
  
  return [{
    key,
    score: review?.score ?? fallbackScore,
    verdict: review?.verdict ?? "该项来自旧版报告的相关细分分数。",
    legacy: !review && fallbackScore != null,
  }];
});
```

**测试**:
- 加载 schema v3 报告
- 加载缺少 `dimensionReviews` 的报告
- 加载缺少 `taskChecks` 的报告

### 2. 图表库主题配置（重要）

**问题**: recharts 默认颜色与项目主题不匹配
**方案**:
```typescript
// 在图表组件中使用 CSS 变量
<Line 
  stroke="hsl(var(--chart-1))" 
  fill="hsl(var(--chart-1))"
/>

// Tooltip 样式
<Tooltip 
  contentStyle={{
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 'var(--radius)',
    color: 'hsl(var(--popover-foreground))',
  }}
/>
```

**验证**: 在 global.css 确认所有 chart 变量已定义

### 3. 数据隐私（中等）

**问题**: 趋势图可能暴露历史练习内容
**方案**:
- 只显示聚合指标（分数、频率）
- 不显示具体话题或逐字稿片段
- 限制显示最近 10 次（不展示全部历史）

### 4. 移动端适配（中等）

**问题**: 图表在小屏幕上可能难以阅读
**方案**:
```tsx
// 响应式调整
<div className="hidden sm:block">
  <TrendLineChart data={trendData} />
</div>
<div className="block sm:hidden">
  <p className="text-xs text-muted-foreground">
    趋势图在大屏幕上显示更佳
  </p>
</div>

// 或者简化移动端图表
<ResponsiveContainer width="100%" height={isMobile ? 150 : 200}>
  {/* 移动端减少数据点 */}
</ResponsiveContainer>
```

### 5. 性能监控（低）

**潜在问题**:
- 历史数据查询可能较慢（用户有100+次练习）
- 图表渲染可能阻塞主线程

**方案**:
```typescript
// 限制查询数量
const historyQuery = useQuery({
  queryKey: ["session-history"],
  queryFn: () => api.listHistory({ limit: 10 }),  // 只取最近10次
  staleTime: 60_000,  // 缓存1分钟
});

// 使用 React.memo 优化图表
export const TrendLineChart = React.memo(function TrendLineChart(props) {
  // ...
});
```

### 6. diff 算法选择（低）

**问题**: 复杂的 diff 算法可能影响性能
**方案**:
- 优先使用简单的字符串匹配
- 如果需要，使用轻量级库 `diff-match-patch`
- 限制 diff 文本长度（超过500字时简化处理）

### 7. 国际化预留（低）

虽然当前只支持中文，但考虑未来可能的 i18n：
```typescript
// 使用常量而非硬编码字符串
const TAB_LABELS = {
  overview: "总览",
  details: "诊断明细",
  feedback: "改写建议",
  materials: "原始材料",
};

// 便于未来替换为 i18n key
```

### 8. 浏览器兼容性（低）

**recharts 要求**:
- 支持 ES6+
- 支持 SVG
- 项目使用 Tauri，目标浏览器版本较新，兼容性问题不大

**测试**:
- Chrome/Edge (Chromium)
- Safari (WebKit)
- Firefox

### 9. 状态管理（注意）

**当前**: ReviewPage 使用 `useState` 管理本地状态
**保持**: 不引入额外的全局状态管理
**原因**: 复盘页是独立页面，状态不需要跨页面共享

### 10. 错误边界（可选）

为图表组件添加 Error Boundary：
```typescript
<ErrorBoundary fallback={<div>图表加载失败</div>}>
  <TrendLineChart data={trendData} />
</ErrorBoundary>
```

---

## 总结

本计划涵盖了复盘页面的全面优化，从数据指标优化到布局重构，再到用户体验增强和数据可视化。核心策略是**在现有基础上增强**，而非推倒重来。

### 关键亮点

1. **Tab 导航**: 将信息分为"总览"、"诊断明细"、"改写建议"、"原始材料"四个独立视图，减少滚动和认知负担

2. **数据可视化**: 引入 recharts 提供趋势折线图和五维雷达图，让用户直观看到进步

3. **激励系统**: 新增"本次亮点"卡片、反复问题进度条、历史最佳标记，增强成功感

4. **信息层级**: 综合分大卡片突出显示，关键指标前置，次要信息折叠

5. **向后兼容**: 所有改动都考虑旧数据格式的降级处理

### 预期效果

**用户体验提升**:
- 找到关键信息的时间从"大量滚动"降低到"一次 Tab 切换"
- 通过趋势图看到长期进步，增强训练动力
- 通过亮点卡片获得即时正向反馈

**技术债务控制**:
- 新增依赖少（3个）且都是 React 生态常用库
- 组件结构清晰，易于维护和扩展
- 向后兼容保证线上数据不受影响

### 风险最小化

- 渐进式实施，可分阶段交付
- 完整的验证计划覆盖各种边界情况
- 保留所有现有功能，只做增强不做减法
- 详细的错误处理和降级方案

### 下一步

1. 获得用户确认此计划
2. 按 Step 1-13 顺序开始实施
3. 每完成一个阶段进行测试
4. 收集用户反馈并迭代优化

---

*计划制定完成时间: 2026-08-19*
*预计实施时间: 4-5 小时*
*涉及文件数: 约 10 个*
