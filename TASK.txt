# 基层医疗情报系统 · 云端每日/每周情报生产规范

> 本文件由云端定时任务读取并严格遵循。所有产出最终写入 data.json（经 merge.js 合并）并发布到固定链接。

## 一、检索范围

用 WebSearch 检索**最近 24~72 小时**的中文公开信息，优先来源：国家卫健委/国家医保局/民政部/工信部官网、中国政府网、中国政府采购网、各省公共资源交易中心、权威媒体。

四个主题：
1. 国家及地方**医疗、养老、基层卫生**相关政策
2. **AI 医疗应用、数字化服务**、政策项目申报通知
3. **医疗器械、软件服务商、基层医疗合作机构**（集采、中标、合作签约）
4. 重点省份（广东、浙江、江苏、四川、河北、福建、新疆、广西等）**行业动态与潜在合作机会**

## 二、每日摘要（new_daily.json）

每天一份，date 用当天真实日期，md 字段为 markdown。**必须包含**以下小节，顺序固定：

```
# 基层医疗情报日报 · YYYY-MM-DD（周X）

## 🔴 今日重点关注（时间敏感）
1~3 条时间敏感项（项目申报/招标截止/报价开始等），写明具体日期时间、金额、事项、来源链接。

## 政策动态
- **标题**（发布主体/文号，日期）：核心要点。
  - 链接：URL

## AI医疗与数字化
## 器械采购与供应商
## 区域动态与合作机会
## 待跟进清单
| 事项 | 关键时间 | 建议动作 |
|------|----------|----------|
```

要点：
- 每条**必须标注来源链接与发布日期**；要点写透（金额、截止时间、覆盖范围、关键指标），不要空泛。
- 待跟进清单用表格，至少 5 行。
- `## 区域动态与合作机会` 段落中，把可跟进的**项目窗口**（区域/类型/金额/截止）同时追加进 new_entries.json 的 `cat:"opportunity"`。

## 三、每周清单（new_weekly.json）

仅当**今天是周一**且 data.weekly 中没有本周 weekId 时生成（weekId 格式 `YYYY-Www`）。md 必须包含：

```
# 基层医疗情报 · 每周政策与合作机会清单（YYYY 第 Ww 周 · MM-DD~MM-DD）

## 本周政策汇总表
| 文件/事件 | 发布主体 | 日期 | 核心要点 | 影响对象 |
| 项目申报/招标窗口
| 机会 | 区域 | 金额/预算 | 截止日期 | 申报主体 |
| 合作与采购机会
| 风险与提示
## 下周行动建议
```

## 四、新增分类条目（new_entries.json）

只收录**尚未收录**的重要条目。结构：

```json
[{"cat":"policy|ai|vendor|opportunity",
  "entry":{"title":"...","section":"...","lines":["- 发布：...","- 要点：...","- 链接：..."]}}]
```

- `cat` 只能是 policy / ai / vendor / opportunity
- `section`：policy 用"2026 年国家级重点政策"/"养老 / 医养结合政策"/"医疗器械 / 设备采购政策"；ai 用"AI 医疗应用与落地"；vendor 用"中标与供应商动态"；opportunity 用"2026-10 近期动态"/"区域动态与合作机会"
- 追加时**不要覆盖**已有条目；merge.js 会按 title 去重

## 五、写入文件（防转义）

markdown 含大量换行，**手写 JSON 字符串会产出非法 JSON**。一律用 node 写：

```bash
# 日报（追加或替换当天）
node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync('new_daily.json','utf8'));const arr=Array.isArray(a)?a:[a];const o={date:'YYYY-MM-DD',md:fs.readFileSync('/tmp/daily.md','utf8')};const i=arr.findIndex(x=>x.date===o.date);if(i>=0)arr[i]=o;else arr.push(o);fs.writeFileSync('new_daily.json',JSON.stringify(arr,null,2))"

# 条目追加
node -e "const fs=require('fs');const arr=JSON.parse(fs.readFileSync('new_entries.json','utf8'));const nw=JSON.parse(fs.readFileSync('/tmp/entries.json','utf8'));for(const it of nw){if(!arr.find(x=>x.cat===it.cat&&x.entry&&x.entry.title===it.entry.title))arr.push(it);}fs.writeFileSync('new_entries.json',JSON.stringify(arr,null,2))"

# 非周一的每日任务：周报写 null
node -e "const fs=require('fs');fs.writeFileSync('new_weekly.json','null')"
```

先把 markdown 原文写到 `/tmp/daily.md`、`/tmp/weekly.md`、`/tmp/entries.json`，再执行上面的命令。

## 六、补齐中断期

若 data.json 的 daily 数组中**最新日期距今天超过 1 天**（说明任务曾中断），把中间所有缺失日期一并补齐，每个缺失日期单独生成一份日报。
注意：`new_daily.json` 从资产线拉取时已内含 10-23~10-26 四份补齐日报，**不要删掉**；merge.js 会按 date 去重，重复插入自动跳过。

## 七、合并与发布

```bash
node merge.js .
```

脚本按 date / weekId / title 去重，原子写入，自动备份。输出形如：
`merged | updated=2026-10-26 | daily 12->13 | weekly 2->2 | entries+N`

随后用 CloudStudio 部署工具发布（action=deploy，directory=当前工作目录，port=3000）。**同目录重复部署复用同一分享链接。**

发布后用 curl 校验：`curl -sS -o verify.json <固定链接>/data.json`，确认 updated 为今天、daily 比发布前 +1（补齐日则 +N）。
