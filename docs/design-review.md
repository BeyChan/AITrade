# AITrade 视觉方向评审

评审日期：2026-11-21 · 范围：`/`、`/cases`、`/competitors`、`/sourcing`、`/cases/[id]/report`
证据来源：`src/app/globals.css`（评审时 11,092 行）、`src/app` + `src/components` 源码、本机 dev server 实机截图（1440×1400 与 375×900）。
计数为评审时快照；工作区有并行改动，数字会小幅漂移。复核方法与结果见第八节。

---

## 一、当前方向是什么

**深绿 SaaS 仪表盘 + 荧光柠檬点缀。**

墨绿侧栏（`#10251c`）+ 柠檬绿强调（`#b9f26c`）+ 白卡片 + 18px 圆角 + 柔和绿调投影 + 全大写英文 eyebrow。
配色本身有行业依据（绿色 = 毛利 / 通关），但呈现方式落在通用 SaaS 模板里，换一个 Logo 就能装任何 B2B 产品。

而这个产品的真实身份不是「增长仪表盘」，是**立项审计台账**：README 第一句就写着「AI 只生成待验证假设，结论由证据和确定性规则决定」。
它的行话是报关单、对账单、信审报告、投委会评审书。**视觉应当像一份经得起复核的单据，而不是像一块看板。**

---

## 二、功能性缺陷（优先于审美）

这些不是口味问题，是会让人读错数、做错题的问题。

### 1. 判定三态被压成两态，且「否决」不是红色 — 严重

`src/app/cases/page.tsx:230` 与 `src/app/cases/[id]/report/page.tsx:156`：

```tsx
background: c.recommendation === "GO" ? "var(--green-soft)" : "var(--amber-soft)",
color:      c.recommendation === "GO" ? "var(--green)"      : "var(--amber)",
```

`NO-GO` 与 `HOLD` 渲染成**完全相同的琥珀色药丸**。产品最核心的输出 —— GO / HOLD / NO-GO 门禁 —— 在案卷总库和决策战报两个最关键页面上只有两种视觉状态，且「停止」没有红色。

设计系统里本来就有正确的三态（`globals.css:738-753`，`.recommendation-no-go` = 红色），这两处用内联三元表达式绕过了它。
`src/app/ai-sourcing/[runId]/page.tsx:1177` 用的才是对的写法。

> 实机可见：`/cases` 四行里 `NO-GO · 50分`、`HOLD · 48分`、`NO-GO · 30分`、`NO-GO · 24分` 颜色一致。

### 2. 未达门禁的净利率没有任何视觉信号 — 严重

`src/app/cases/page.tsx:268`：

```tsx
color: res && res.marginRate >= 0.18 ? "var(--green)" : "inherit"
```

达标 → 绿色；不达标 → **普通墨色**，和「预估售价」长得一模一样。
18% 门禁是全产品的中心规则，`9.2%` 和 `7.9%` 却在页面上毫无警示。不达标不是「中性」，是**失败**，必须有独立信号。

### 3. 「预估月贡献」无条件染绿 — 严重

`src/app/cases/page.tsx:278`：`color: "var(--green)"`，没有任何条件。
于是一个 `NO-GO · 24分`、净利率 7.9% 的否决案卷，月贡献 `$5,024.00` 仍然是绿的。
**同一行里，数字说「赚钱」，判定说「否决」。** 绿色在这里表示「钱」，而不是「通过」——语义冲突。

### 4. 财务数字无法跨行比较 — 严重

`src/app/cases/page.tsx:243`：`gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))"`，
每格是「标签: 数值」内联排布，标签宽度不一（预估售价 / 到岸成本 / 基准净利率 / 预估月贡献），列数还随容器宽度重排。

结果：想竖着扫一眼四个案卷的净利率（16.8% / 18.4% / 9.2% / 7.9%）**做不到**，每行数字的横向位置都在漂移。
一个专门用来横向比单位经济的工作台，恰恰不支持横向比。

### 5. 全库零等宽数字

`grep -c "tabular-nums" src/app/globals.css` → **0**。
金额、百分比、分位、评分全部用比例数字，小数点不对齐。

### 6. 中文正文小到不可读

字号分布（`globals.css` 出现次数）：

| 字号 | 次数 | | 字号 | 次数 |
|---|---|---|---|---|
| 11px | 129 | | 9px | **59** |
| 10px | 84 | | 8px | **22** |
| 12px | 79 | | 7px | **8** |

主力字号是 9–12px，另有 11.5 / 12.5 / 10.5 / 13.5 / 9.5 / 14.5 等半像素值，共 25+ 种。

具体落点：
- `globals.css:5409` — `.ai-candidate-comparison-table thead th { font-size: 8px }`，内容是 `<th>维度</th>` 和供应商中文全名（`supplier-candidate-workspace.tsx:231`）。**买手挑工厂的对比表，表头 8px 中文。**
- `globals.css:4222` — `.ai-cost-inputs small, .ai-cost-fields small { font-size: 9px }`，成本测算字段的中文说明。

PingFang SC 在 12px 以下笔画开始糊，8–9px 中文基本不可读。这不是紧凑，是失效。

### 7. 琥珀色小字未过 AA

`--amber #a96610` on `--amber-soft #fff3d9` = **4.15:1**，低于 4.5。而它正是 HOLD 徽标和大量 9–11px 小字的颜色。
其余色对均达标（muted 5.11 / green 4.65 / red 5.51 / lime 12.26）。

### 8. 电话号码被折断

`/sourcing` 供应商卡片：`135-` ↵ `0921-6650`、`186-` ↵ `5792-3340`、`138-` ↵ `5740-8891`。
联系方式在数字中间换行，无法直接读或复制。

### 9. 无障碍与响应式基线缺失

- `prefers-reduced-motion`：**0** 处
- `focus-visible`：**1** 处（11k 行 CSS）
- 34 处 `!important`，断点散落 20+ 个（1120 / 1080 / 1024 / 980 / 960 / 920 / 720 / 640…），无统一栅格

---

## 三、模板化的地方（审美）

对照通用 AI 生成页面的常见特征：

| 特征 | AITrade 现状 |
|---|---|
| 全大写 tracked-out eyebrow | 15 处 `text-transform: uppercase`。`CROSS-BORDER OPS`、`SUPPLY CHAIN ASSET POOL · 供应链中台`、`LIFECYCLE PIPELINE · 操盘手业务大盘`、`AITRADE · PRODUCT INVESTMENT MEMO`、`PIPELINE` / `PROJECTED` / `MARGIN` / `ACTION REQUIRED` / `BOUNDARY` |
| 中点串 `A · B · C` | `ASIN: B0DEMO0001 · 责任操盘手: AI 运营组`、`US · 类目: 宠物饮水器 · …`、`投资决策 · 战报评审` |
| 链接尾巴挂箭头 | `继续验证 →`、`去定标 →`、`定标审批 →`、`去确认 →`、`审阅草稿 →`、`查看决策战报 (Memo) →`、`打开 1688 主页 ↗` |
| 小标签用等宽字体 | 20 处 mono，全部用在**标签**上 |
| 同款圆角卡片阵列 | 每页顶部固定 4 张统计卡，同圆角同投影，右上角还各贴一块四分之一圆渐变斑（纯装饰） |
| 渐变铺底 | `body` 与 `sidebar` 各两层 radial-gradient 光晕 |
| 大数字 + 小标签 + 强调色 | 4 张统计卡的标准做法 |

**中文产品挂英文大写 eyebrow 尤其无效**：`PIPELINE` 压在「推进中商品」上方、`PROJECTED` 压在「测算预期月毛利」上方，对中国运营者不提供任何新信息，纯属装饰。
`/cases` 的 `案卷总控 · 全生命周期跟踪` 压在 H1「商品工作台」上，也是同义反复。

**一处做对了**：5 阶漏斗的 `1 2 3 4 5` 编号 —— 内容确实是序列，编号承载信息，保留。

### token 漂移

- **圆角 20+ 种**：4/5/6/7/8/9/10/11/12/13/14/15/16/18/26/99/999/50%。不是「一个圆角包打天下」，是根本没有尺度。
- **字距 12 种**、**投影 12 种**（全是同一个柔和绿灰的微调变体）。
- **722 处内联 `style={{}}`**、**335 处内联 `fontSize`**，与 1006 处 `var(--)` 并存 —— 一半在系统内，一半在系统外。
- **20 处 Tailwind 冷灰硬编码**（`#f8fafc` / `#edf2f7` / `#f1f5f9` …）掺进暖绿中性色（`--canvas #f3f6f2` / `--line #dfe6e0`），两套中性色打架。`/cases` 财务条那层发蓝的灰就是这个原因。
- 图标语言分裂：侧栏是线性图标，正文按钮是 emoji（🖨 📥 ⚡ 💡 🏭 📋 🔍 ✨）。

---

## 四、建议方向：跨境立项审计台账

不是换皮，是把「证据分级」和「门禁」从徽标提升为**视觉主语**。

### Color — 收紧到 6 个，并把语义分离

| token | hex | 唯一用途 |
|---|---|---|
| `--ink` | `#18221d` | 正文（保留，暖绿黑很好） |
| `--paper` | `#ffffff` | 单据面 |
| `--canvas` | `#f3f6f2` | 底衬（保留） |
| `--deep` | `#10251c` | 侧栏（保留） |
| `--green` | `#1f7a55` | **只表示「达标 / 通过」**，不再表示「钱」 |
| `--seal` | `#b8322a` | 印泥朱红，**只用于否决落章**（对白 5.95:1） |
| `--amber` | `#8a5309` | 存疑 / HOLD（对 `#fff3d9` 5.74:1，过 AA） |

**退役 `--lime #b9f26c` 作为 CTA 色。** 荧光柠檬是「增长 / 初创」的语气，这个产品的语气是「别亏钱」。
品牌识别交给墨绿 + 单据版式，强调色只留给判定三态。绿色不再兼职「金额」，冲突即消失。

朱红取自公章 / 骑缝章 / 发票批注的行话 —— 是这份单据自己的语言，不是随手挑的亮色。

### Type — 把等宽和黑体的角色**对调**

现状：标签用等宽（通用 tell），数字用比例黑体（读不了列）。建议正好反过来：

- **标签 / 中文正文** → PingFang SC / Noto Sans SC，安静，不抢戏
- **金额 / 百分比 / ASIN / SKU / 评分** → 等宽 + `font-variant-numeric: tabular-nums`，**右对齐**

对账单的数字本来就是等宽的。这一条同时解决可读性和「像一份账」的辨识度。

字号砍到 7 档，**12px 是中文地板**：

```
12 · 13 · 14 · 16 · 20 · 26 · 34
```

删掉全部 7 / 8 / 9 / 10px 与半像素值。行高：中文 1.7，数字 1.4。

### Layout — 案卷总库从卡片阵列改成台账

```
┌────┬──────────────────────────┬────────┬────────┬────────┬────────┬──────────┐
│ ▌  │ 案卷 / ASIN              │  售价  │  到岸  │  净利  │ 净利率 │  判定    │
├────┼──────────────────────────┼────────┼────────┼────────┼────────┼──────────┤
│ ▌  │ 不锈钢宠物饮水机          │  39.99 │  12.40 │   6.70 │ 16.8 ▏ │ ⊘ NO-GO  │
│ ▌  │ B0DEMO0001 · 宠物饮水器   │        │        │        │   ↑18  │   50 分  │
├────┼──────────────────────────┼────────┼────────┼────────┼────────┼──────────┤
│ ▌  │ 自清洁宠物梳              │  24.99 │   5.20 │   4.61 │ 18.4 ▏ │ ◑ HOLD   │
│ ▌  │ B0DEMO0002 · 宠物清洁     │        │        │        │   ↑18  │   48 分  │
└────┴──────────────────────────┴────────┴────────┴────────┴────────┴──────────┘
  ▌= 证据尺（实色=已核实 / 虚线=AI待核实）      ▏= 18% 门禁刻度线
```

- 左对齐文字，**右对齐数字**，表头吸顶
- 净利率格内画一条 18% 刻度：达标越过线，未达标短一截 —— **门禁是一条线，不是一种颜色**
- 左缘证据尺：`marketplace` / `captured` 实线，`ai_model_site_import` / `template` 虚线。README 里那张来源分级表，直接变成可以扫一眼的视觉编码
- 判定列做成落章样式，三态三色

### Principles

1. **证据分级是视觉主语** —— 任何数字都能一眼看出是核实过的还是 AI 推演的
2. **18% 门禁画成一条线**，不是一种颜色
3. **数字右对齐等宽，标签左对齐黑体**（与现状完全相反）
4. **大胆只花一处**：决策战报上的落章式判定。其余全部安静
5. 删掉所有英文大写 eyebrow、中点串、链接尾箭头；编号只留在真序列（5 阶漏斗）上

### 自查：这个方案本身通用吗？

- 「墨绿 + 白 + 朱红」会不会又落进「近黑底 + 单一亮色」的俗套？—— 不是近黑底，是纸白单据面；朱红只出现在落章一处，且来自公章行话，不是随手挑的强调色。**通过。**
- 「等宽数字」会不会是 tell？—— tell 是**小标签**用等宽。这里是财务列用等宽，对账单的本来形态，且解决实际的列对齐问题。**通过。**
- 「台账表格」会不会是 broadsheet 俗套？—— 不是报纸密排栏，是单张对账表；发丝线只用在行分隔与门禁刻度，都有信息职责。**通过。**
- 统计卡阵列 —— 已删除，改为台账表头汇总行。**通过。**

---

## 五、动手顺序

**P0 · 语义正确性**（半天，改动小、收益最大）
1. `cases/page.tsx:230` 与 `report/page.tsx:156` 改用 `.recommendation-go / -hold / -no-go` 三态类
2. `cases/page.tsx:268` 未达 18% 给明确警示色，不要 `inherit`
3. `cases/page.tsx:278` 月贡献去掉无条件绿色
4. `--amber` 改 `#8a5309` 过 AA

**P1 · 可读性**（1–2 天）
5. 全局 `font-variant-numeric: tabular-nums`，金额/百分比右对齐
6. 抬字号地板到 12px，重点清掉 8px 表头与 9px 成本字段
7. 电话号码 `white-space: nowrap`
8. 补 `:focus-visible` 与 `prefers-reduced-motion`

**P2 · 方向落地**（3–5 天）
9. `/cases` 改台账表 + 证据尺 + 门禁刻度
10. 建字号 / 圆角 / 投影三套 scale，收敛 719 处内联样式
11. 删英文 eyebrow、中点串、尾箭头、统计卡渐变斑
12. 退役 lime CTA，落章式判定上战报

---

## 六、结论

配色底子是好的 —— 暖绿墨色有行业依据，对比度基本达标，5 阶编号用对了。
问题在**执行层**：判定三态被内联三元压成两态、门禁失败无信号、金额无条件染绿、11k 行 CSS 没有字号尺度、中文掉到 8px。

**先修语义，再修可读性，最后才谈风格。** 现在最不该做的是换配色 —— 换了色，`NO-GO` 还是琥珀色的。

---

## 七、ui-ux-pro-max 复核补充

用 `ui-ux-pro-max` 检索库（67 style / 96 palette / 57 font pairing / 99 UX 准则）复核了一遍。

### 7.1 库的主推方案不适用，不要照抄

`--design-system` 对 "b2b cross-border ecommerce sourcing decision audit dashboard" 的返回：

| 项 | 库的推荐 | 为什么不适用 |
|---|---|---|
| Pattern | Data-Dense Dashboard， sections `Hero > Features > CTA` | AITrade 是内部工作台，没有 Hero / Features / CTA 这套落地页结构 |
| Style | **Dark Mode (OLED)**，anti-pattern 写着「Light mode default」 | 恰恰相反：这是要打印成 A4 立项战报的单据产品，浅色纸面是刚需 |
| Colors | `#0F172A` / `#1E293B` / `#020617` | 正是第三节查出的、已经在污染暖绿系统的 Tailwind 冷灰 |
| Typography | **Fira Code + Fira Sans** | **两者都没有中文字形**。界面 95% 是中文，全部回落系统字体，这个 pairing 等于没设 |
| Effects | `text-shadow: 0 0 10px` 微光 | 审计单据不需要发光 |

补充核实：`data/typography.csv` 共 57 条 pairing，只有 **2 条**涉及中文（第 24 条 Noto Serif/Sans TC、第 25 条 **Noto Sans SC**）。
也就是说这个库的字体推荐对中文产品基本失效，**只有 Latin / 数字那一半可用**。第 25 条 Noto Sans SC 才是本项目该走的。

### 7.2 库里真正命中的条目

`--domain style "light minimal professional enterprise document"` 的 Result 2 —— **Minimalism & Swiss Style**：
「Enterprise apps, dashboards, professional tools / grid-based / WCAG AAA / `--border-radius: 0` / `--shadow: none` / 单一强调色 / 避免阴影与渐变」。
这与第四节的台账方向一致，且直接否定了现状的 12 种投影 + 双层渐变光晕 + 20 种圆角。

同次检索的 Result 1 **Neumorphism** 被库自己标了 `⚠ Low contrast`，Result 3 **Trust & Authority** 是落地页风格 —— 都不适用。

`--domain ux` 命中的、与本项目实测对得上的：

| 准则 | 严重度 | AITrade 实测 |
|---|---|---|
| Font Size Scale：用统一模块化尺度 | Medium | 25+ 种字号，含 7/8/9px 与半像素 |
| Color Contrast ≥ 4.5:1 | High | `--amber` on `--amber-soft` = 4.15 ✗ |
| Focus States 可见 | High | 见 7.3，实际失效 |
| Reduced Motion | High | 0 处 |
| Bulk Actions：多选 + 操作条，不要每行重复动作 | Low | `/cases` 4 行 × 5 个相同按钮 = 20 个重复控件 |
| Table Handling：`overflow-x-auto` | Medium | 台账化改造时需要 |
| Number Formatting：千分位 | Low | 已做对（`$33,098.00`），保留 |

`--stack nextjs` 命中：`next/font` 自托管（0 处使用）、`next/image`（0 处使用，4 处原生 `<img>`）。

### 7.3 新查出的缺陷

#### A. 焦点环对比度 1.13:1，且全局修复被特异性压过 — 严重

`globals.css:9433` 有一条**写法正确**的全局焦点环，注释还专门说明了为什么要加：

```css
:where(a, button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--green);   /* 对白 5.29:1，合格 */
  outline-offset: 2px;
}
```

但 `:where()` 把内部特异性归零，整条只有 `:focus-visible` 贡献的 **0,1,0**。
而各表单自带的 `:focus` 规则特异性更高，全部压过它：

```css
.field input:focus,               /* 0,2,1 */
.field textarea:focus,
.field select:focus,
.ai-inbox-apply-form input:focus,
.ai-field-review-form textarea:focus { … }
  box-shadow: 0 0 0 3px rgba(31, 122, 85, 0.09);
```

`rgba(31,122,85,0.09)` 叠白 = **`#ebf3f0`**，对白 **1.13:1**。
WCAG 2.2 SC 1.4.11 非文本对比要求 ≥ **3:1**。这个环肉眼几乎看不见。

**净效果：那条本来正确的无障碍修复，在几乎所有表单控件上都不生效，取而代之的是一个看不见的环。**

修法二选一：把 `box-shadow` 的 alpha 从 `.09` 提到 `.35` 以上，或把全局规则从 `:where(...)` 改成正常选择器列表以抬升特异性。

#### B. ⌘K 全局检索输入框完全没有焦点指示 — 严重

`globals.css:10390`：

```css
.global-search-input {
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}
```

三条 `!important` 把所有焦点指示强制清除，且**容器没有任何 `:focus-within` 规则**（已 grep 确认）。
一个以键盘为第一交互方式的功能，键盘用户看不到焦点在哪。

#### C. 约 124 处 emoji 当图标，另有 74 处箭头字符

按完整 Unicode 区段统计 `src/app` + `src/components` 的 `.tsx`：emoji / 符号 **198** 处，分布 **31** 个文件；
其中箭头类（`→` `↗` `↓`）**74** 处，扣除后 emoji 图标约 **124** 处。
（初稿按固定样本列表数出的 66 处是低估，已更正。）

与侧栏的线性图标语言分裂。emoji 在不同系统渲染不同、无法跟随字色、屏幕阅读器会读出「打印机」等无关语义。
换 Lucide / Heroicons，统一 24×24 viewBox；74 处尾箭头按第三节一并删除。

#### D. 375px 实机：首屏被侧栏吃光 + 悬浮胶囊挡住主操作

以 CDP 驱动真实 Chrome，在 375×812 移动仿真下量测 `/cases`（方法见 8.7）：

- **侧栏高 404px，占视口 49.7%**；业务标题「商品工作台」的文档纵坐标 **639px** —— 首屏 79% 的位置才开始业务内容
- **悬浮「AI 助手 & 搜索」胶囊压住「批量导入商品」按钮 82%**：
  胶囊 `position: fixed; z-index: 90`，151×42 位于 (206, 748)；按钮 118×42 位于 (187, 751)，重叠 **4063 px²**。
  这是当前视口内唯一被遮挡的控件，但它是页面两个主 CTA 之一。
- 「设置」组的「店铺连接 / 大模型设置」换行后与「商品工作台」并排，分组关系丢失
- **沙盒警告**（防止误改真实店铺的最重要提示）被挤到侧栏下方
- 侧栏链接 `min-height: 32px`、`font-size: 11px`，低于 44px 触控目标建议
- `.work-context-bar` 里的「去定标 →」右缘超出视口 **107px**，但它在一个 `overflow-x: auto` 的横滑条内 —— 不是布局破裂，是**下一步动作在窄屏不可见且无滑动提示**

> **更正**：初稿据 1440 宽截图旁的一张 375 截图断言「存在横向溢出、演示模式开关被裁」。
> 实测 `documentElement.scrollWidth === 375 === viewport`，移动仿真与非移动仿真**两种条件下横向溢出均为 0**；
> 「演示模式」开关右缘 348px，完整在视口内。重拍当前构建的 375 截图确认无裁切。
> 原截图取自会话中途的旧构建（工作区当时正在并行改 `globals.css` / `app-sidebar.tsx`）。**该断言撤回。**

断点共 **16 种**（520 / 620 / 640 / 680 / 720 / 780 / 800 / 820 / 900 / 920 / 960 / 980 / 1024 / 1080 / 1100 / 1120），**最小 520px，没有 375 / 480 档**。

#### E. 无图片优化

0 处 `next/image`，4 处原生 `<img>`；0 处 `next/font`。

### 7.4 合并后的优化清单

在第五节 P0/P1/P2 基础上插入：

**P0 追加**
- 焦点环 alpha `.09 → .35+`（或抬升全局 `:focus-visible` 特异性）—— 实测 `/settings` 37% 键盘停靠点无可见焦点
- `.global-search-input` 恢复焦点指示，或给容器加 `:focus-within`
- **打印样式补 app shell**：`globals.css` 里隐藏 `.sidebar / .topbar / .sandbox-banner / .work-context-bar / .floating-assistant-launcher`，并解除 `.app-workspace` 的 232px 左边距（详见 8.8）

**P1 追加**
- 约 124 处 emoji → Lucide 统一图标集
- 补 375 / 480 断点；侧栏在 ≤720px 改抽屉，把首屏还给业务内容
- 悬浮胶囊在窄屏收起为纯图标或上移，避免压住「批量导入商品」（实测遮挡 82%）
- 沙盒警告条移到内容区顶部并常驻
- `.work-context-bar` 的「下一步」在窄屏改为可见按钮，不依赖无提示的横滑
- 触控目标 ≥ 44px

**P2 追加**
- 字体走 `next/font` 自托管 **Noto Sans SC**（中文）+ 等宽（数字），不要用库主推的 Fira
- 4 处 `<img>` → `next/image`
- `/cases` 台账化时加多选 + 批量操作条，替掉 20 个重复行内按钮
- 采纳 Swiss 的 `--shadow: none` / 单一强调色，清掉 12 种投影与渐变光晕

**明确不做**：库主推的 Dark Mode (OLED)、Hero/Features/CTA 结构、Tailwind 冷灰、Fira 字体、发光效果。
---

## 八、复核验证（2026-11-21）

本文档是评审结论，不含任何业务代码改动。以下是对文中断言的复核。

### 8.1 行号引用 —— 全部仍指向所述内容

工作区有并行改动，`globals.css` 已从 11,081 增至 11,092 行，逐条复查：

| 引用 | 复查结果 |
|---|---|
| `cases/page.tsx:230 / 231` | ✓ 仍是 `=== "GO" ? … : "var(--amber-soft)"` 三元 |
| `cases/page.tsx:243` | ✓ 仍是 `repeat(auto-fit, minmax(130px, 1fr))` |
| `cases/page.tsx:268` | ✓ 仍是 `>= 0.18 ? "var(--green)" : "inherit"` |
| `cases/page.tsx:278` | ✓ 仍是无条件 `color: "var(--green)"` |
| `report/page.tsx:156` | ✓ 仍是同一个二元三元 |
| `globals.css:4222 / 5409` | ✓ 仍为 `font-size: 9px` / `8px` |
| `globals.css:9433` | ✓ 仍是 `:where(…):focus-visible` |
| `globals.css:10390` | ✓ 仍是 `outline: none !important` |
| `ai-sourcing/[runId]/page.tsx:1177` | ✓ 仍是正确的三态分支 |

### 8.2 计数 —— 逐项重跑

`tabular-nums` 0、`uppercase` 15、`!important` 34、`prefers-reduced-motion` 0、`focus-visible` 1、
冷灰硬编码 20、`next/image` 0、原生 `<img>` 4、`next/font` 0、`@media` 断点 16 种、
9px 59 / 8px 22 / 7px 8 —— **全部与文中一致**。

小幅漂移（并行改动所致，已更新正文）：内联 `style={{}}` 719 → **722**，内联 `fontSize` 334 → **335**。

**一处更正**：emoji 初稿用固定样本列表数出 66 处，属低估。按完整 Unicode 区段重数为
emoji/符号 198 处（31 个文件），扣除 74 处箭头后约 **124** 处。正文已改。

### 8.3 对比度 —— 两套独立实现互验

Node 与浏览器 `getComputedStyle` 两条独立路径，结果一致：

| 断言 | 实测 | 判定 |
|---|---|---|
| `--amber #a96610` on `#fff3d9` | **4.15** | ✗ 未过 AA 4.5 |
| 焦点环 `rgba(31,122,85,.09)` 叠白 = `rgb(235,243,240)` | **1.13** | ✗ 远低于非文本 3:1 |
| 建议 `--seal #b8322a` on `#ffffff` | **5.95** | ✓ |
| 建议 `--amber #8a5309` on `#fff3d9` | **5.74** | ✓ |

### 8.4 层叠胜负 —— 在真实浏览器引擎中验证

headless Chrome 的文档不获得焦点（实测 `document.hasFocus() === false`），
`:focus` / `:focus-visible` 无法直接触发。改用**特异性等价模型**：
`:nth-child(1)` 与 `:focus` / `:focus-visible` 同为伪类（0,1,0），替换后层叠关系不变。

在 Chrome 中实测 `getComputedStyle`：

```
M1  :where(…):nth-child(1)  (0,1,0)  vs  .m1 input:nth-child(1)  (0,2,1)
    → outline = rgb(9,9,9) 9px   表单规则胜出，全局焦点环被压过        ✓ 断言成立

M2  :where(…):nth-child(1)  vs  .m2 { border/outline/box-shadow: none !important }
    → outline=none  boxShadow=none  border=0px none   三种指示全被清除  ✓ 断言成立
```

**未能验证的部分**：真实焦点状态下 `:focus-visible` 是否在这些控件上匹配（headless 限制）。
不影响结论 —— M1 的胜负由特异性决定，M2 由 `!important` 决定，两者都与焦点是否匹配无关。

### 8.5 实机截图

1440×1400 的 `/`、`/cases`、`/sourcing`，与 375×900 的 `/cases`，均取自本机已在运行的 dev server。
375px 下「演示模式」开关被右边缘裁切、侧栏占约 400px 首屏高度，为截图直接可见。

### 8.6 本次会话的实际改动

- `docs/design-review.md`（本文件，新增）
- `~/.claude/skills/` 下 17 条软链接 → `~/.agents/skills/`，全部解析成功、`SKILL.md` 可读、无实体副本、无断链
- `.claude/launch.json` 曾临时加过 attach 配置，**已还原**，`git diff` 为空

**未改动任何业务代码**，因此没有 UI 行为可供验证；上述验证针对的是评审断言本身的准确性。

### 8.7 真实浏览器实测（补齐 8.4 未能验证的部分）

8.4 用特异性等价模型推断层叠胜负，但 headless 文档不获焦点，无法验证真实 `:focus-visible`。
本轮自建了一个最小 CDP 驱动（raw-socket WebSocket 客户端 + `Emulation.setFocusEmulationEnabled`），
驱动独立 profile 的 Chrome 157 直接量测**运行中的 AITrade**，`document.hasFocus() === true`。

#### 焦点指示 —— 实测，不再是推断

`/settings`，聚焦后等待 400ms 让 transition 结束再读 `getComputedStyle`：

| 控件 | `:focus-visible` | outline | box-shadow 环 | 环对比 | 边框对比 | 结论 |
|---|---|---|---|---|---|---|
| `.field input` | **true** | `none` | `rgba(31,122,85,.09)` | **1.13** | `#7eb89b` **2.28** | 无合规指示 |
| `.field select` | **true** | `none` | 同上 | **1.13** | **2.28** | 无合规指示 |
| `.site-switcher-field select` | **true** | `none` | `rgba(185,242,108,.2)` | **1.06** | lime **1.31** | 无合规指示 |
| 裸 `textarea`（`/competitors`，无 `.field` 包裹） | true | `2px solid #1f7a55` | — | — | — | **5.29 ✓ 全局环生效** |

三点确认：
1. `:focus-visible` **确实匹配**这些控件 —— 全局规则本该生效。
2. 它被表单自带的 `:focus` 规则压过，`outline` 实测为 `none`。**8.4 的模型推断得到实测证实。**
3. 新增细节：连兜底的边框变色也不达标（2.28 / 1.31，均 < 3:1）。**没有任何合规的焦点信号。**
4. 反证：没有 `.field` 包裹的裸 `textarea` 上，全局环正常生效（5.29）—— 说明规则本身没写错，问题就是特异性。

#### ⌘K 全局检索 —— 实测

通过 `window.dispatchEvent(new CustomEvent('aitrade:open-search'))` 打开（`global-search.tsx:53` 的入口），
不点击任何业务控件。实测 `.global-search-input`：

```
focus: true   focus_visible: true
outline:   none 3px
boxShadow: none
border:    0px none
外层 .global-search-input-wrap: boxShadow none / border 0px none
```

**输入框与其容器都没有任何焦点指示。** 断言 B 由静态 grep 升级为实测确认。

#### 量测方法上的一个坑

首次探针在 `el.focus()` 后立刻读 `getComputedStyle`，`.field input` 返回
`box-shadow: rgba(0,0,0,0) 0px 0px 0px 0px` —— 那是 `transition: box-shadow .15s` 的**起始帧**，
不是「无指示」。等待 400ms 后才读到真实终值 `rgba(31,122,85,.09)`。
**测过渡属性必须等过渡结束**，否则会得出比实际更糟的结论。

#### 375px 布局 —— 量测推翻了一条断言

`documentElement.scrollWidth = 375 = clientWidth`，移动仿真与非移动仿真**均无横向溢出**。
「演示模式」开关右缘 348px，完整可见。初稿的「横向溢出」断言撤回（详见 7.3 D 的更正框）。

同时精确量到：侧栏 404px / 49.7% 视口、H1 纵坐标 639px、
悬浮胶囊遮挡「批量导入商品」**82%（4063 px²）** —— 后者是本轮新发现的真实缺陷。

#### 仍未验证

- 未做键盘 Tab 遍历全站的焦点可达性普查（只抽测了上述控件）
- 未在真实移动设备上验证，仅 Chrome 移动仿真
- 未验证打印 / PDF 输出的实际渲染

### 8.8 补齐剩余两项：键盘遍历普查 与 打印输出

8.7 末尾列的三项「仍未验证」，本轮做掉两项（真机无设备，仍无法验）。

#### 键盘 Tab 遍历普查

用 `Input.dispatchKeyEvent` 只发 Tab（不发 Enter/Space，不激活任何控件），
每步等 280ms 让过渡结束，读 `document.activeElement` 的 outline / box-shadow 并算对比度，
以 **≥3:1** 为「焦点可见」判据：

| 页面 | Tab 停靠点 | 焦点可见 | **在屏但无可见指示** | 视口外 |
|---|---|---|---|---|
| `/settings` | 30 | 19 | **11（37%）** | 0 |
| `/cases` | 30 | 28 | **2（7%）** | 0 |

**结论比原先更精确**：链接和按钮的全局焦点环是正常工作的（`/cases` 28/30 可见）。
失效**集中在表单控件**——`input` / `select` / `textarea`，以及顶栏那两个全局 `select`（1.06:1，两页都中）。
`/settings` 因为表单密集，三分之一的键盘停靠点看不见焦点。

所以修复面比「全站无障碍重做」小得多：把表单 `:focus` 的 ring alpha 提上去，或抬升全局 `:focus-visible` 特异性，即可覆盖绝大多数。

#### 打印 / A4 PDF —— 发现一个新的严重缺陷

README 宣称「专用 `@media print` 样式，一秒保存为专业 PDF 汇报书」。实测**不成立**。

打印样式确实存在，但只写在报告页自己的 `<style>` 里（`src/app/cases/[id]/report/page.tsx:481-503`），
只覆盖 `.no-print` / `body` / `.page` / `article`。
**它不知道自己被渲染在 app shell 里面**——侧栏、顶栏、沙盒条、上下文条、悬浮胶囊都不带 `.no-print`。

`Emulation.setEmulatedMedia({media:'print'})` 下实测（已清除视口 override）：

| 元素 | print 下 display | 尺寸 | 是否隐藏 |
|---|---|---|---|
| `.sidebar` | `flex` | 232×757 | **否** |
| `.topbar` | `block` | 1208×103 | **否** |
| `.sandbox-banner` | `flex` | 1208×41 | **否** |
| `.work-context-bar` | `flex` | 1208×38 | **否** |
| `.floating-assistant-launcher` | `flex` | 201×48 | **否** |
| `.app-workspace` | `block` | **marginLeft 仍为 232px** | 否 |
| `.breadcrumb` / `.no-print` | `none` | 0×0 | 是 ✓ |

`Page.printToPDF`（A4，preferCSSPageSize）导出实际结果：**2 页，595.92×841.92 pt**，其中

- 第 1 页顶部依次印出：整条墨绿侧栏（含「重置演示样板数据」按钮）、沙盒警告条、顶栏站点选择器、上下文条、悬浮 AI 胶囊。
  **真正的战报内容到页面 55% 处才开始。**
- 第 2 页签批栏之后 **约 60% 是空白**，底部又印了一次悬浮胶囊。
- `.app-workspace` 的 232px 左边距在打印时保留，每页左侧白扔一条。

一份要拿去给投委会签批的立项战报，印出来带着导航栏和「重置演示数据」按钮。

**修法**：把 app shell 的 chrome 一并纳入打印隐藏，并解除左边距。

```css
@media print {
  .sidebar, .topbar, .sandbox-banner,
  .work-context-bar, .floating-assistant-launcher { display: none !important; }
  .app-workspace { margin-left: 0 !important; }
}
```

这段应放进 `globals.css`（全局），而不是报告页的局部 `<style>`——否则下一个要打印的页面会重蹈覆辙。

> **方法更正**：首次导出时我带着 1440px 的 `setDeviceMetricsOverride`，PDF 右侧内容被裁。
> 那是**我的视口 override 造成的假象**，清除后内容完整、无溢出（实测 `article` 内 0 个元素越界，
> 财务表右列 `$39.99` 等数值齐全、颜色正常）。**「打印内容被裁」不成立，已排除。**
> 成立的是「app shell chrome 未被打印样式隐藏」——与视口无关，两种条件下一致。

#### 仍未验证

- 真实移动设备（无设备，仅 Chrome 移动仿真）
- 键盘遍历只覆盖 `/settings` 与 `/cases` 各 30 步，未穷尽全站

---

## 九、修复落地情况（2026-11-21）

按第一节至第五节的问题清单动手，以下为**已改并已验证**的部分。

### 9.1 已修复

| # | 问题 | 改法 | 验证 |
|---|---|---|---|
| 1 | NO-GO 与 HOLD 同色 | `cases/page.tsx` 与 `report/page.tsx` 的二元三元改为三态类 `.verdict-pill.is-go/.is-hold/.is-no-go`、`.memo-stamp.*` | 实机截图：NO-GO 红、HOLD 琥珀，两态可分 |
| 2 | 18% 门禁失败无信号 | 不达标改为 `var(--red)` 并附「↓」与 `title` 说明 | 实机：`16.8% ↓` / `9.2% ↓` / `7.9% ↓` 标红，`18.4%` 绿 |
| 3 | 月贡献无条件染绿 | 仅在 `recommendation === "GO"` 时绿 | 实机：NO-GO 案卷的 `$12,060.00`、`$5,024.00` 回归墨色 |
| 4 | `--amber` 未过 AA（4.15） | `#a96610 → #8a5309` | 实测 5.74:1 |
| 5 | 焦点环 1.13:1 且被压过 | 全局规则 `:where()` → `:is()`，特异性 0,1,0 → 0,3,0；环 alpha `.09 → .3` | **Tab 遍历 `/settings`：30/30 可见（改前 19/30）** |
| 6 | ⌘K 无焦点指示 | 补 `.global-search-input:focus-visible` 与 `-wrap:focus-within` | 规则存在；未单独复跑实机 |
| 7 | 战报 PDF 印进 app shell | `globals.css` 追加全局 `@media print`，隐藏侧栏/顶栏/沙盒条/上下文条/悬浮胶囊并解左边距 | **实测五者均 `display:none`；PDF 由 2 页 2 页空白 → 1 页，内容从页首开始** |
| 8 | 财务数字跨行对不齐 | `repeat(auto-fit…)+内联标签` → `.metric-strip` 固定 6 列 + `.metric-cell` 右对齐 | 实机：四行 `$39.99 / $24.99 / $59.99 / $19.99` 同一 x 位置 |
| 9 | 全库 0 处等宽数字 | `body { font-variant-numeric: tabular-nums }` + 数字位 `--font-mono` | 4 处规则，实机生效 |
| 10 | 中文掉到 7–11px | 314 条 `<12px` 声明统一抬到 12px；半像素值归一 | `<12px` 声明数 314 → **0** |
| 11 | 电话号码中间折断 | `supplier-directory-client.tsx` 改 `minmax(0,1fr) auto` + `nowrap` | 实机：`135-0921-6650` 单行 |
| 12 | 无 `prefers-reduced-motion` | 追加全局降级规则 | 规则存在 |
| 13 | 英文大写 eyebrow | `.eyebrow` 去 `uppercase`、字距 `0.12em → 0.01em`；删除 `SUPPLY CHAIN ASSET POOL · 供应链中台`、`案卷总控 · 全生命周期跟踪`、`投资决策 · 战报评审` | 实机：sourcing 页眉已消失 |
| 14 | 统计卡装饰渐变斑 | 删除 `.metric-card::after` | 实机：四卡右上角斑块消失 |
| 15 | 375px 侧栏吃掉半屏 | 侧栏 `max-height: 168px` + 内部滚动；`app-workspace` 去左边距；导航横滑 | 待复测首屏占比 |
| 16 | 悬浮胶囊遮挡主 CTA 82% | 窄屏收成 48×48 图标，隐藏文字与 kbd | **实测遮挡控件数 1 → 0** |
| 17 | 触控目标 32px | 窄屏 `.sidebar-link` 提到 44px | CSS 规则 |
| 18 | 无 480px 断点 | 补 `480px`：指标条 2 列、品牌副标隐藏 | CSS 规则 |
| 19 | 字体依赖系统回退 | `layout.tsx` 接入 `next/font`：Noto Sans SC + JetBrains Mono，自托管 | `<html>` 实测带两个 `__variable` 类，页面 200 |
| 20 | 战报缺少落章 | `.memo-stamp` 描边落章，NO-GO 用印泥朱红 `--seal #b8322a` | PDF 实件可见 |

**改动文件**：`globals.css`、`layout.tsx`、`cases/page.tsx`、`cases/[id]/report/page.tsx`、`sourcing/page.tsx`、`supplier-directory-client.tsx`，新增 `components/icons.tsx`。

### 9.2 未完成

| 项 | 现状 | 原因 |
|---|---|---|
| emoji → SVG | 仅 `cases/page.tsx` 换成 `IconDownload` / `IconPrinter`；**约 130 处仍散在 20 个文件**（competitors 39、global-search 18、content 14 为最集中） | 换图标需逐个判断是图标位还是正文，机械批量替换会误伤；工作量另计 |
| 尾箭头删除 | 仅删了 cases 页那处；**69 处仍在** | 同上，散落在多页面 |
| 722 处内联样式收敛到 token | 未动 | 属结构性重构，与工作区里正在进行的 image-studio 改动大面积重合（`content/`、`settings/`、`app-sidebar.tsx` 均在并行修改中），此时代码搬家冲突风险高 |
| `next/image` 替换 4 处 `<img>` | 未做 | 2 处在 `image-studio-panel.tsx`（并行开发中的新文件）；另 2 处为用户上传的动态图，转 `next/image` 需配 `width/height` 或 `fill` + 定位父级，改布局风险大于收益 |
| `tsc --noEmit` | **未能运行** | 本机 `typescript@7` 缺 `@typescript/typescript-darwin-arm64` 平台包，且沙箱内 Node 为 18。**类型检查未被验证过**，建议你在自己的环境跑一次 `npm run typecheck` |
| 真实移动设备 | 未测 | 无设备，仅 Chrome 移动仿真 |

### 9.3 回归自检

- 七个主路由 `/ /cases /competitors /sourcing /content /settings /connections` 全部 200
- 二元判定三元残留 0 处（grep 命中的唯一一条是本次加入的注释）
- `<12px` 字号声明 0 条
