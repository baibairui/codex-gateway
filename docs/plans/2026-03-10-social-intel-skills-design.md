# Social Intel Skills Design

## Goal

给 `codex-gateway` 新增一组面向社交媒体公开信息采集和内容沉淀的 agent-local skills，让 agent 能稳定完成两类任务：

- 从 `X/Twitter`、小红书、抖音、B 站、微信公众号等平台获取公开信息
- 把调研结果整理并写入飞书 DocX / Wiki

## Scope

首轮设计采用“两层 skill”结构：

- 通用 skill
  - `social-intel`
  - `social-doc-writer`
- 单平台 skill
  - `x-research`
  - `xiaohongshu-research`
  - `douyin-research`
  - `bilibili-research`
  - `wechat-article-research`

首轮覆盖四类任务：

- 热点/舆情收集
- 账号内容调研
- 竞品与行业动态跟踪
- 素材搜集后整理成飞书文档

## Recommended Approach

采用“通用编排 + 单平台深挖 + 复用现有执行 skill”的方案。

1. `social-intel` 作为入口型 skill，负责把用户目标拆成平台、关键词、时间范围、证据标准，再决定是否调用单平台 skill。
2. 单平台 skill 负责平台内搜索、提取、证据记录和平台特有约束。
3. `social-doc-writer` 负责把结构化调研结果写入飞书文档，不直接负责采集。
4. 所有网页访问和页面交互继续只走 `gateway-browser`。
5. 所有真实飞书写入继续只走 `feishu-official-ops`。

这样做的原因：

- 多平台任务和单平台任务的触发条件不同，拆开后 agent 更容易选对流程。
- 平台差异大，单平台规则需要独立演进。
- 采集和写文档是两类完全不同的失败模式，不应混在一个大 skill 里。

## Architecture

### 1. `social-intel`

职责：

- 识别任务属于热点收集、账号调研、竞品跟踪还是素材汇总
- 先澄清平台范围、关键词、时间范围、输出格式
- 要求结果必须包含来源链接、发布时间、作者/账号、摘要、证据
- 跨平台任务时，按平台拆分执行并最终汇总
- 单平台深挖时，转入对应平台 skill

该 skill 不直接承诺“拿到所有平台 API 数据”，默认以公开页面、公开搜索结果、用户可访问页面为边界。

### 2. 单平台 research skills

每个单平台 skill 只管本平台：

- `x-research`
  - 公开帖子、账号页、搜索页
- `xiaohongshu-research`
  - 公开笔记、搜索结果、作者主页
- `douyin-research`
  - 公开视频页、搜索结果、账号页
- `bilibili-research`
  - 视频页、合集/频道页、UP 主主页
- `wechat-article-research`
  - 公众号文章链接、文章正文、可抓取的公开文章页

每个单平台 skill 都应约束 agent：

- 先确认平台和目标对象，再搜索
- 先记录证据，再下结论
- 区分“公开页面不可访问”“需要登录”“没有结果”“证据不足”
- 不伪造阅读量、点赞量、发布时间等字段
- 页面结构不稳定时，优先保守提取并回报不确定性

### 3. `social-doc-writer`

职责：

- 接收结构化调研输入
- 生成适合飞书 DocX / Wiki 的调研文档
- 支持“新建文档”和“向已有文档追加章节”
- 统一输出章节结构，例如：
  - 任务背景
  - 调研范围
  - 核心发现
  - 平台分节结果
  - 证据链接
  - 风险与缺口

## Tooling Boundary

这些新 skill 自己不增加新的底层执行脚本，首轮以编排现有能力为主：

- 网页检索、访问、截图、页面提取：复用 `./.codex/skills/gateway-browser`
- 飞书真实写入：复用 `./.codex/skills/feishu-official-ops`

这意味着第一版重点是“让 agent 更会用 gateway 已有能力”，不是接入一套新的社媒 API。

## Installation Model

这些 skill 作为仓库内置 agent-local skills 放进 `./.codex/skills`，并由 workspace 初始化逻辑自动安装到新 agent workspace。

首轮需要扩展 workspace 安装逻辑，使新建 agent 时自动具备：

- `social-intel`
- `social-doc-writer`
- `x-research`
- `xiaohongshu-research`
- `douyin-research`
- `bilibili-research`
- `wechat-article-research`

## Output Contract

为了让 `social-doc-writer` 能稳定消费前置结果，采集类 skill 的输出应统一成近似结构：

- `platform`
- `query`
- `time_range`
- `items`
- `summary`
- `gaps`

其中 `items` 每条至少包含：

- `title`
- `author`
- `published_at`
- `url`
- `evidence`
- `notes`

skill 文档里不需要要求 agent 真正输出 JSON，但要明确这些字段是最低信息标准。

## Failure Handling

首轮明确四种失败类型：

- 平台公开页面不可访问
- 平台需要登录或人工接管
- 页面结构变化导致提取不完整
- 证据不足，无法给出可靠结论

每个 skill 都必须要求 agent 在失败时报告：

- 阻塞原因
- 已获得的证据
- 尚缺失的信息
- 推荐的下一步

## External Skill Findings

已确认外部 skill 生态存在若干可借鉴的单点能力，但没有现成组合满足本项目目标：

- `rohunvora/x-research-skill@x-research`
- `zhjiang22/openclaw-xhs@xiaohongshu`
- `xiaoyiv/douyin-skill@douyin`
- `aidotnet/moyucode@bilibili-analyzer`
- `freestylefly/wechat-article-extractor-skill@wechat-article-extractor`

这些结果说明：

- 单平台能力在生态里是成立的
- 但本项目仍需要自己的通用编排 skill 和飞书沉淀 skill
- 平台内深挖更适合作为轻量独立 skill，而不是全部塞进一个大 skill

## Testing Strategy

测试分两层：

1. 文件安装与发现
   - 新 skill 目录、`SKILL.md`、必要的 `agents/openai.yaml` 被正确写入
   - `/skills` 能列出这些 skill
2. workspace 初始化
   - 新建 workspace 后自动安装这些 skill
   - `AGENTS.md` 中能注入最小但明确的使用规则，提示优先使用社媒调研 skill 与文档沉淀 skill

首轮不做真正的平台联网集成测试，避免把外部站点波动引入单测。

## Non-Goals

- 首轮不接入各社交平台官方 API
- 首轮不保证登录态抓取和私域内容读取
- 首轮不实现自动发布回社交媒体
- 首轮不实现复杂的反爬规避逻辑
