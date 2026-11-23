# feishu-channel

把 dsh 变成常驻的飞书机器人：**WS 长连接收消息 → 白名单过滤 → 按 chat 路由到独立 Session → 在本进程里跑一轮 agent → 把回答发回飞书**。
不经过 MCP，不轮询，不需要 `dsh-headless` 子进程。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 插件：`apply(ctx, config)` 里起 `WSClient`，装配各模块；白名单、会话状态（按天轮换）、撤回处理、调度器接线 |
| `src/constants.js` | 运行参数与上限常量：下载上限、卡片推送/打印节奏、引用/合并转发限制等 |
| `src/message-format.js` | 纯函数：text/post 解析、卡片文字提取、消息渲染、本地历史摘要 |
| `src/lark-utils.js` | 纯函数：附件命名/类型判定、Lark 错误响应解析、流读取 |
| `src/text-utils.js` | 文本工具：`shorten` / `clip` / `split` |
| `src/inbound.js` | 入站：消息结构解析、撤回摘要、引用/合并转发读取、附件下载归档、图片入库（`createInbound` 工厂注入 `client`/`log`/`attachments`） |
| `src/card-stream.js` | 流式卡片：chunk 帧打字机更新、end 帧收尾、打印队列排空、失败退回普通消息（`createCardStream`） |
| `src/outbound.js` | 出站：引用回复/主动消息/安全兜底与 `outboundTarget` 发送目标（`createOutbound`） |
| `src/turn-driver.js` | 回合驱动：steer 交付、driver 循环、超时取消、assistant 文本转播（`createTurnDriver`） |
| `src/web-mirror.js` | 网页→飞书镜像：主人私聊的每日飞书会话（含往日）里网页发起的回合，先发 `[user asked from web] 问题`，再逐条转发助手文本（`createWebMirror`） |
| `src/session-id.js` | `isOwnerSessionId`：判断 session id 是否为主人私聊的每日会话（网页镜像用） |
| `test/helpers.test.js` | `node --test` 冒烟用例（纯函数与常量，`npm test` 运行） |
| `test/inbound.test.js` | 入站解析/摘要/合并转发渲染用例 |
| `test/outbound.test.js` | 发送目标选择用例（直发/引用/主动） |
| `test/web-mirror.test.js` | 网页镜像用例（问题前缀、镜像去重、channel 驱动时不重复转发） |
| `test/session-id.test.js` | 主人会话 id 判定用例 |
| `test/panel.test.js` | 面板参数投影/校验与 client bundle 注册用例 |
| `src/memory-store.js` | 记忆存储层：Markdown 文件、原子写、mtime 缓存、条数/字节上限 |
| `src/memory-context.js` | Preset 插件：每回合注入全局记忆 + 当前 chat 记忆（只读） |
| `src/memory-tool.js` | Preset 插件：注册 `feishu_memory` 工具，作用域守卫硬编码 |
| `src/memory-curator.js` | Host 插件：每晚把最近会话摘要交给 `feishu-root` 整理写入 |
| `src/history-store.js` | 本地聊天历史：每 chat 一个 JSONL，记录用户/机器人可见消息与 `message_id`，原子写、条数上限 |
| `src/history-context.js` | Preset 插件：每轮注入最近聊天记录（含 `message_id`）和发送方式说明 |
| `src/reply-tool.js` | Preset 插件：注册 `feishu_reply_mode` 工具，模型选择引用回复或直接发送 |
| `src/send-file.js` | Preset 插件：注册 `feishu_send_file` 工具，把服务器文件/图片发回 owner 私聊 |
| `src/send-text.js` | Preset 插件：注册 `feishu_send_text` 工具，随时主动发一条新消息（不引用） |
| `src/schedule-tool.js` | Preset 插件：注册 `feishu_schedule` 工具，创建/查看/取消定时任务 |
| `src/scheduler.js` | 定时任务存储与时间计算：JSON 持久化、每日滚动、错过补跑策略 |
| `src/channel-runtime.js` | Host 插件与 preset 工具之间的单例接口（`sendChatText` / 任务增删查 / `setDelivery`） |
| `src/panel-runtime.js` | Host 插件与面板 Host 半身之间的单例接口（快照 / 动作 / 记忆明细） |
| `src/curator-runtime.js` | 记忆整理插件的运行时状态与 `runNow` 单例接口 |
| `ui/index.js` | 面板 Host 半身（独立包 `@local/dsh-feishu-panel`）：`/feishu-panel/*` JSON 路由 |
| `ui/params.js` | 面板参数纯函数：`settings.describe` 行投影、写入校验、路由前缀归一化 |
| `ui/presets.js` | 工具挂载纯函数：`plugins` 行树投影、按路径切换 `disabled` |
| `ui/client.js` | 浏览器 bundle：侧栏「飞书」图标 + 整页控制台（概览/会话/定时任务/记忆/设置） |
| `ui/package.json` | 面板独立包清单（`dsh.client.platform=web`）；单独成包是为了不和 channel 的多 Loader 条目冲突 |
| `cordis.patch.yml` | bundle patch：channel 插件 + 记忆整理插件 + 三个 agent preset（`feishu` / `feishu-power` / `feishu-curator`） |
| `AGENTS.md` | 群聊/普通会话守则；部署时放进 `FEISHU_CWD`，由 `agent-instructions` 加载 |
| `POWER.md` | owner 私聊专用守则（执行权限、密钥卫生、防注入）；同一个目录，power preset 只认这个文件名 |
| `package.json` | bundle 清单（`dsh.bundle.patch`）；`dsh` 声明依赖版本范围 |
| `locale/*.json`、`icon.svg` | Plugin Manager / 设置页的显示信息 |

## 安装

```sh
# 1. 建一个独立 profile（别用 desktop），模板取 web：它带 session-controller / agent-loop / 持久化
dsh --profile feishu --from-default-profile web

# 2. 把本目录作为一个 bundle 装进该 profile；dsh plugin add 会同时把它写进 dsh.profile.bundles
dsh plugin --profile feishu add /absolute/path/to/feishu-channel

# 2b. 本地目录装成的是软链，pnpm 不会替它装自己的依赖；在 bundle 目录里补一次
(cd /absolute/path/to/feishu-channel && pnpm install)

# 3. 如果当前 dsh 版本没有自动登记，再手动把 "@local/dsh-feishu-channel" 加进
#    $DSH_HOME/profiles/feishu/package.json 的 "dsh.profile.bundles"（只加一次，别重复）

# 4. 把两份守则放进这个 profile 的工作目录（路径与 FEISHU_CWD 一致）
mkdir -p /home/ubuntu/feishu-workspace
cp /absolute/path/to/feishu-channel/AGENTS.md /absolute/path/to/feishu-channel/POWER.md /home/ubuntu/feishu-workspace/

# 5. 飞书 MCP（仅 owner preset 用到，可选）：单独部署到 /home/ubuntu/lark-mcp-dsh 并 npm install
#    路径写死在 cordis.patch.yml 的 mcp-client-feishu 里，换路径要同步改
```

也可以直接让 dsh 会话里的 agent 用 `plugin_manager install_bundle` 装（它同时完成 pnpm 安装与 bundles 选择）。

## 配置

`cordis.patch.yml` 里的值来自环境变量（Loader 激活时求值，密钥不落盘）：

```yaml
appId: !!js process.env.FEISHU_APP_ID
appSecret: !!js process.env.FEISHU_APP_SECRET
cwd: !!js process.env.FEISHU_CWD
allowedChatIds: !!js (process.env.FEISHU_ALLOWED_CHAT_IDS || '').split(',')
allowedOpenIds: !!js (process.env.FEISHU_ALLOWED_OPEN_IDS || '').split(',')
```

| 变量 | 必须 | 说明 |
|---|---|---|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 是 | 飞书自建应用凭据；需在开放平台开启「长连接」并订阅 `im.message.receive_v1`；要用撤回提醒还要额外订阅 `im.message.recalled_v1`（加事件后要发布应用版本才生效）。收事件要 `im:message.p2p_msg:readonly` + `im:message.group_at_msg:readonly`，下载附件与接收撤回事件要 `im:message:readonly`（或 `im:message`），上传附件要 `im:resource`，发消息要 `im:message:send_as_bot`；流式卡片还要 `cardkit:card:write`（加后同样要发布版本） |
| `FEISHU_CWD` | 否 | 每个 Session 的工作目录；`AGENTS.md` 就放在这里 |
| `FEISHU_ALLOWED_CHAT_IDS` | 是（否则不接收） | 允许的群聊 chat_id，英文逗号分隔 |
| `FEISHU_ALLOWED_OPEN_IDS` | 是（否则不接收） | 允许私聊的用户 open_id，英文逗号分隔 |
| `FEISHU_MEMORY_DIR` | 否 | 记忆目录，默认 `~/.dsh-feishu-memory` |
| `FEISHU_OWNER_CHAT_ID` | 否 | 主人私聊的 chat_id；该 chat 使用 `feishu-power` preset，并且只有它可以写全局记忆 |
| `DSH_PERMISSION_MODE` | 否 | `danger-full-access` 时 owner 会话等同本机 agent（无审批、可写任意目录）；默认 `workspace-write`，系统目录只读 |
| `FEISHU_CURATOR_TIME` | 否 | 每晚整理时间 `HH:MM`，默认 `03:17`（`Asia/Shanghai`） |
| `FEISHU_CARD_STREAMING` | 否 | 设为 `false` 关闭流式卡片，退回每步一条普通富文本消息；默认开启。面板可热改 |
| `FEISHU_SYNC_WEB` | 否 | 设为 `false` 关闭「网页→飞书镜像」；默认开启。只镜像主人私聊的每日飞书会话里由网页发起的回合。面板可热改 |
| `FEISHU_SCHEDULE_FILE` | 否 | 定时任务持久化文件，默认 `~/.dsh-feishu-schedules.json` |
| `FEISHU_HISTORY_DIR` | 否 | 本地聊天历史目录，默认 `~/.dsh-feishu-history` |
| `DEEPSEEK_API_KEY` | 是 | 模型凭据；`llm-deepseek` 行的 `apiKeyEnv` 默认就是它 |

**首次接入怎么拿 id**：两个白名单先留空启动，给机器人发一条消息（群里要 @ 它）。日志会出现一行：

```text
feishu-channel: ignored message chat=oc_xxx chat_type=p2p sender=ou_xxx (not allowlisted)
```

只记录 id、不记录正文。把 `chat` 填进 `FEISHU_ALLOWED_CHAT_IDS`（群聊），把 `sender` 填进 `FEISHU_ALLOWED_OPEN_IDS`（私聊），重启即可。

## 权限模型（owner / 群聊）

一个进程里按 chat 路由到不同 preset，路由只看飞书事件里的 `chat_type` 和 `chat_id`，消息内容改不了它：

| 会话 | preset | 能力 |
|---|---|---|
| owner 私聊（`FEISHU_OWNER_CHAT_ID`） | `feishu-power` | bash / 文件读写 / 文件搜索 / 联网 / 后台任务 / todo / skill / 子代理 / 发文件、主动发消息、定时任务 / 飞书 API 工具（MCP：文档、日历、任务、wiki、通讯录、消息读取） + 记忆 + 聊天历史 + 发送方式选择 + 压缩 |
| 群聊、其他私聊 | `feishu` | 对话 + 记忆 + 聊天历史 + 发送方式选择，没有任何执行工具 |
| `feishu-root`（记忆整理） | `feishu-curator` | 只有记忆工具 |

- owner 侧配上 `DSH_PERMISSION_MODE=danger-full-access` 后，沙箱全关、审批永不打断，能力等同旧 CC bot；不设则默认 `workspace-write`，写系统目录会被沙箱拦住。
- **安全边界要认清**：owner 和群聊共用同一个 dsh 进程、同一个 `ubuntu` 账号。群聊之所以安全，是因为它的 preset 里根本没有工具，而不是沙箱挡住了什么。以后群聊机器人也要工具时，必须拆成独立实例 + 独立系统账号（`dsh-group`），不能只在一个 preset 里放开。
- owner 会话里模型理论上能读到自己进程的密钥（它要拿 app secret 连飞书），和旧 CC bot 相同；约束靠 `POWER.md` 的密钥规则和「只有 owner 私聊能触发这个 preset」。
- preset 在会话创建时固定：部署后当天已存在的 `feishu-*` 会话仍用旧 preset，第二天按天轮换自动生效；想立刻验证可以停掉服务后把当天对应会话目录移走（`~/.dsh/sessions/--home-ubuntu-feishu-workspace--/<session-id>`），再启动。日志里 `created session ... preset=feishu-power` 表示新会话用上了 owner preset。

## 飞书 API 工具（MCP，仅 owner 私聊）

`feishu-power` preset 里挂了一个外部 MCP server（`@deepseek-ai/dsh-mcp-client`，stdio），把飞书开放平台能力接给模型：

- 代码独立于本 bundle：服务器上放 `~/lark-mcp-dsh`（制作副本在 `Desktop/harness/lark-mcp-dsh`），用 `node_modules/tsx` 直接跑 TypeScript。改代码后重启 `dsh-feishu` 即可，MCP 子进程随 preset 重新拉起；日志里出现 `[lark-mcp-dsh] Server ready` 表示握手成功。
- 工具名统一是 `mcp__feishu__<原工具名>`，共 49 个：auth（status/init/whoami）、通讯录搜索、日历、任务、文档（读写/创建/搜索/导入导出/素材）、wiki、云文档评论，以及消息读取（read/get_message/fetch_resource/search/patch）。
- **不包含**收消息、发消息、定时、卡片回调类工具：WS 收消息和回复仍由 channel 负责，MCP 不抢职责；发送用 `feishu_send_text` / `feishu_reply_mode` / `feishu_send_file`。
- OAuth：`feishu_auth_init` 给 owner 发授权卡片，走设备码流程；工具调用会阻塞等待授权（`toolCallTimeoutMs: 660000`，给 10 分钟留余量）。token 在 `~/.config/lark-mcp-dsh/tokens.json`（与 CC 版 `~/.config/lark-mcp/tokens.json` 隔离），自动刷新；日志 `~/.config/lark-mcp-dsh/lark-mcp.log`。
- 权限身份：日历/任务/文档/wiki/消息搜索/通讯录走用户身份（OAuth scope）；读消息/取资源/patch 卡片、评论、wiki 租户工具走应用身份。完整 scope 清单与批量导入 JSON 见 `lark-mcp-dsh/README.md`。
- 限制：群聊 preset 没有这个 MCP。wiki 的 `*_tenant` 工具要求机器人应用已是该知识空间成员；评论工具用应用身份，文档未授权给应用时会 `permission denied`。
- 注意：MCP 工具逐个的可用性尚未全部实测，按实际使用逐步修；新增飞书 API 工具改 `lark-mcp-dsh`，不要在 channel 里加重叠的发送/监听逻辑。

## 会话与行为

- **一个 chat 一个 Session，按天轮换**：session id = `feishu-<chat_id>-<YYYYMMDD>`，默认按 `Asia/Shanghai` 切日。第二天自动新建会话，历史不会再滚进新上下文；旧 Session 仍在磁盘上，可按 id 恢复。当天会话在**第一条消息到达时按需创建**（不预建空会话）。
- **网页→飞书镜像**（`FEISHU_SYNC_WEB`，默认开）：只有主人私聊的每日飞书会话（`feishu-<owner_chat_id>-YYYYMMDD`，含往日）里、由网页（`source.rpcId`）发起的回合会被镜像——先单独发一条 `[user asked from web] 问题`（超过 4000 字符截断），再把该回合每一步的助手文本按顺序转发到 owner 私聊；channel 自己驱动的回合不重复转发。网页里另开的普通会话、其他 chat 的会话都不镜像，回复只留在网页。往日会话镜像时只会传话，不会让 channel 接管那个会话。这个开关在控制面板的「参数」里可以热改。
- **白名单默认拒绝**：私聊按发送者 open_id 判断，群聊按 chat_id 判断；不在名单里的消息只记一行日志。
- **群聊默认要 @ 机器人**（`requireMentionInGroup`），并且只申请 `im:message.group_at_msg:readonly` 权限，非 @ 消息不会推过来。
- **去重**：按 `message_id` 记最近 1000 条，WS 重连时飞书重投的旧事件不会重复触发。
- **运行中到达的消息是追加消息**：agent 正在跑时，新消息用 `agent.steer` 放进 `next-step`，模型在下一个步骤看见它，仍属于同一轮——不会另起一轮把答案拆开。agent 空闲时 `steer` 会唤醒新一轮。同一步骤里如果 @ 了两次，模型会一起看到。代价是：轮次可以被不断延长，所以有下面的活动超时与绝对上限。
- **超时会中止**：一轮里既没有新产出、也没有新消息超过 `replyTimeoutMs`（普通 chat 默认 180s，owner 私聊默认 900s），或单轮总时长达到 `maxTurnMs`（默认 1800s），就 `agent.cancel` 并回一句超时提示。取消时**没被模型领取**的追加消息不会被丢掉：插件通过 `agent/inbox/discarded` 把它们放回队列、自动重开一轮；已经被领进模型的则随取消结束。
- **撤回提醒**：订阅 `im.message.recalled_v1`。事件只带 `message_id`，插件用自己留的最近消息摘要（最多 500 条、每条 120 字）拼一句系统提示，让模型忽略被撤回的内容并纠正已给出的回答。三种时机分别处理：消息还在下载/归档→直接丢弃；还在排队→抽掉队列项；已经交给模型→运行中 `steer` 提醒，空闲时挂到下一条消息前面（不会为了撤回单独开一轮）。同时删除该消息在 `~/feishu-history/files` 里的归档副本（文件名以 `消息id-` 开头）。
- **支持文本、富文本、图片、文件、语音、视频、引用消息、合并转发**：图片作为原生 image block 交给模型直接看；owner 私聊的附件统一落盘并给路径，群聊维持内联/描述；引用与合并转发按 `message_id` 读回原文。详见下一节。
- **流式卡片**：模型开始生成文本时（收到第一段 `text-delta`）创建一张 CardKit 卡片实体（JSON 2.0，单个 markdown 元素，`streaming_mode=true`），按当前发送方式用 `im.message.reply` 引用发出或 `im.message.create` 直接发出；之后把累计文本按约 120ms 节流推给同一个元素，飞书端就是打字机效果（新文本以旧文本为前缀时续写，否则整段替换）。卡片显式配置 `streaming_config`：`print_strategy=delay`、`print_frequency_ms=20`、`print_step=8`（约 400 字/秒，高于模型产出速度，打印队列不会越积越多）——默认的 `fast` 策略会在每次更新到达时把上一段没打完的字直接倾倒上屏，观感是分段跳动；`delay` 则先打完旧内容再打新内容。该步提交后用最终 `assistant/message` 文本收尾，并按客户端打印速率估算剩余没打完的字数、等它排空后再关闭 `streaming_mode`（最多等 5 秒）——关流式会把队列里剩下的字一次性上屏；但不关的话聊天预览会一直显示「生成中」，卡片也不能转发。每一步（每次 assistant 提交）各自一张卡，最后一张即总结；只有工具调用、没有文字的步骤不建卡。飞书客户端需要 ≥ 7.20；7.20–7.22 不支持自定义打印参数，只能按默认值（`fast`/70ms/1 字）。
- **卡片兜底**：建卡、内容更新、关流式任何一步失败（没开权限、网络、配额）都退回下面的普通消息路径，不会丢回答；单条正文超过 8000 字符时卡片只显示截断内容，完整文本另发普通消息补齐。`cardStreaming=false`（或 `FEISHU_CARD_STREAMING=false`）时完全不用卡片。
- 普通消息与兜底默认走 `im.message.create` 直接发到 chat_id；模型选择引用时走 `im.message.reply`，此时用 `msg_type=post` + `md` 节点，飞书按 CommonMark/GFM 渲染 Markdown（标题、列表、表格、代码块等），表现为「引用原消息再回复」。引用目标是本轮触发消息或本地历史里选中的消息（见「发送方式与本地历史」）。post 整条上限 30KB，超过 3500 字符自动拆条。
- **超时收尾**：超时取消后会短暂等待落盘（最多 5 秒），把取消前已生成的部分文本也发出来，再发超时提示。
- 这是**单进程**方案：每个 chat 一个常驻 driver，进程内的 chat 并行；同一 chat 的消息按到达顺序准备（下载串行），交给模型后由 dsh 的 inbox 串行处理。

## 媒体输入

| 飞书消息类型 | 处理方式 |
|---|---|
| `text` | 原文，并还原 @ 占位符 |
| `post`（富文本） | 拼回纯文本；内嵌图片逐张下载后作为 image block（群聊里 @ + 图片的常见形态） |
| `image` | `im.messageResource.get` 下载 → 校验 png/jpeg/webp/gif → `ctx.attachments.admitPromptContent` 转 durable 引用 → 作为原生 image block 放进 user message（模型直接看图）；同时归档到历史目录 |
| `file` | 先下载归档。owner 私聊直接给绝对路径，由 power preset 用命令处理；群聊维持：图片文件转 image block（≤20MB），文本类内联开头 64KB，其余只给文件名/大小 |
| `audio` / `media` | owner 私聊下载归档并给路径；群聊只生成一句说明 |
| `merge_forward` | 用 `im.message.get` 取回父消息与全部子消息（子消息 `upper_message_id` 指向父消息），按顺序渲染成「序号. (发送者) 内容」，最多 50 条、正文共 12000 字符；子消息里的卡片会遍历 card JSON 提取标题和文字；图片等附件只给占位符 |
| 引用（任意类型带 `parent_id`） | 按 `parent_id` 用 `im.message.get` 单条读回被引用消息，以「[引用消息｜发送者 …]」放在本条正文前；引用里的文本还原 @，卡片消息提取里面的文字；富文本/图片消息里的图片最多下载 4 张作为 image block（仅图片类型；文件/语音/视频/卡片里的图片给占位符） |

- 所有下载到的附件统一存到 `~/feishu-history/files`（目录 0700、文件 0600），文件名为 `消息id-序号-净化后的原名`；**插件不自动清理**，磁盘由使用者负责。唯一的例外是消息被撤回：插件会删掉该 `消息id-` 前缀的归档副本。
- 上限：普通文件/语音/视频 50MB，流式写盘不占内存；图片 20MB（`dsh-attachment-local` 的单图上限）。超限时删除半成品并降级成文字说明；群聊文本文件最多内联开头 64KB。
- owner 私聊不再把文本文件内联进消息，只给路径，模型按需读取。PDF/Office/压缩包/音视频能否解析取决于服务器装了哪些工具（pdftotext、libreoffice、ffmpeg 等），模型会先检查再回答，没有就如实说明。
- 群聊仍然只接收 @ 消息，所以群里单独发的图片不会被推送；群里要带图，用「@ + 图片」的富文本（post），私聊直接发图片即可。
- 图片能看的前提是模型路由声明了 image 输入；`dsh-base` 默认的 `deepseek-flash` 支持。换成纯文本模型时图片会退化成占位提示。
- 下载消息资源（`im.messageResource.get`）与按 ID 读消息（`im.message.get`，引用/合并转发用；带 `card_msg_content_type=user_card_content` 才返回可解析的卡片 JSON——schema 2.0、正文在 `body.elements[].content`，默认常是卡片引用/模板信封、提取不到文字）都需要 `im:message:readonly`；只开 `im:resource` 不够——它覆盖的是上传资源，以及「下载机器人自己上传的图片/文件」（`im.image.get` / `im.file.get`），不覆盖读取他人消息里的附件。`im:message.history:readonly` 或宽泛的 `im:message` 也能覆盖，但权限更大，不建议。引用/合并转发**不需要**拉群历史的重权限（`im:message.group_msg`）。
- 上传资源（发文件）才用 `im:resource`。下载失败时 channel 会把飞书返回的 `code`/`msg` 一起交给模型，不再只剩一个 `HTTP 400`。
- 图片字节存入 dsh 的 attachment 存储，会话日志里只记引用；`~/feishu-history/files` 是插件自己的归档副本。

## 媒体输出（owner 私聊）

`feishu_send_file` 工具把服务器上的文件/图片发回当前会话。它只挂载在 `feishu-power`，工具内部还会硬性校验调用方 Session 必须是 `feishu-<FEISHU_OWNER_CHAT_ID>-<日期>`；群聊 preset 没有这个工具，记忆整理会话也没有。

| 输入 | 上传接口 | 飞书消息 |
|---|---|---|
| 图片（png/jpeg/webp/gif/bmp/tiff/ico，≤10MB） | `im.image.create`（`image_type=message`） | `msg_type=image` |
| 其他文件（≤30MB，含超过 10MB 的图片） | `im.file.create`（`file_type=stream`） | `msg_type=file` |

- 参数：`path` 必填（优先绝对路径，支持 `~`，相对路径按 `FEISHU_CWD` 解析）；`name` 可选，作为飞书里的显示名。
- 上传用流式读文件，不把整个文件读进内存；目录、空文件、超过 30MB 的文件直接拒绝并返回原因。
- 扩展名像图片但内容不被飞书接受时，自动降级成文件消息发送，结果里带 `note`。
- 文件消息没有说明文字，模型这一轮的正文会作为单独的消息发出；文件用 `im.message.create` 直接发到 chat_id，不走 `im.message.reply` 的引用回复路径。
- 出站只需 `im:resource`（上传资源）和 `im:message:send_as_bot`（发消息）；入站下载附件另需 `im:message:readonly`，两者不是一回事。
- 群聊暂不支持发文件；以后群侧要发文件，必须等独立实例（`dsh-group`）落地后单独设计审批与白名单。
- preset 在会话创建时固定：部署后当天已存在的 owner 会话要等次日按天轮换，或删掉当天会话再重启，才会出现这个工具；日志里 `created session ... preset=feishu-power` 表示新会话已带上。

## 主动发言与定时

机器人可以在没人发消息时主动开口，有两个入口，都只挂在 `feishu-power` 且硬性校验调用方 Session 是 `feishu-<FEISHU_OWNER_CHAT_ID>-<日期>`：

| 工具 | 作用 |
|---|---|
| `feishu_send_text` | 立刻发一条新的 Markdown 消息（不引用任何消息）；默认发回主人私聊，也可用 `chat_id` 指向白名单群聊 |
| `feishu_schedule` | 管理定时任务：`create`（`text` + `after_seconds` / `at` / `daily` 三选一）、`list`、`cancel`（`task_id`） |

**定时任务怎么跑**：任务存在 `~/.dsh-feishu-schedules.json`（0600，原子写），由 channel 每 5 秒扫描一次。到点时不是去唤醒「创建任务那天的会话」，而是用目标 chat **当天**的 `feishu-<chat_id>-<日期>` 会话（没有就新建），往 inbox 里放一条带「定时任务触发」框架的 user message；模型这一轮的可见回复不引用旧消息，直接 `im.message.create` 发成新的聊天消息，流式卡片同样生效（卡片也用 create 发出）。所以每日重复任务天然跟着按天轮换走，不会把上下文锁在过期会话里。

- 为什么不用 dsh 自带的 `dsh-schedule`：它的提醒在创建时绑定 `session.id`，两天后触发仍会投递到旧会话，和按天轮换冲突。这里只存目标 `chat_id`，触发时再取当天会话。
- 每日任务（`daily: "HH:MM"`）触发后直接滚到下一次；服务器宕机错过的历史次数不补，只算下一次。
- 一次性任务错过超过 24 小时会在启动加载时作废；24 小时内的会照常补发。
- 创建/触发/取消都会在 journal 里留一行 `feishu-channel: scheduled task ...`；任务最多 50 个，`text` 最多 2000 字符。
- 触发时如果这个 chat 正在和主人对话，定时提示会作为追加消息并入当前轮（默认仍直接发新消息）；空闲时才是纯粹的新消息主动发言。
- 时间按 `timeZone`（默认 `Asia/Shanghai`）解释；`at` 也接受带时区的 ISO 8601。白名单之外的 chat 不接收任何主动消息；白名单群聊被移出后，指向它的旧任务会在触发时被丢弃并记日志。
- 主动发送只需 `im:message:send_as_bot`，无需新权限。

## 发送方式与本地历史

不再写死「每条回复都必须引用原消息」，而是默认直发、需要时由模型选择引用：

- **默认**：用 `im.message.create` 直接发一条新消息，不引用任何消息。
- **`feishu_reply_mode` 工具**（`feishu` / `feishu-power` 都有）：只在确实需要指明“在回应哪一句”时使用。模型在开始输出正文前调用，`mode=reply` 缺省引用本轮触发消息，加 `message_id` 可引用「最近聊天记录」里的任意一条；`mode=direct` 可显式改回直发。工具只改这一轮的发送方式，本身不发送内容。
- 流式卡片、分片普通消息、超时/出错提示都按同一个选择走。卡片在正文开始流出时建好，之后再调工具不会改变已经发出的那张卡。
- **引用兜底**：如果引用目标被撤回/删除，`im.message.reply` 会失败；channel 自动改用 `im.message.create` 把同一条内容发成新消息（流式卡片同样处理），不会再把回复吞掉。

本地历史（`src/history-store.js`）：

- 每 chat 一个 JSONL：`~/.dsh-feishu-history/<chat_id>.jsonl`（目录 0700、文件 0600，临时文件 + rename 原子写）。
- 只记机器人收到/发出的可见消息，用户消息带 `message_id`，机器人消息记终稿和实际发出的消息 id；图片/语音/视频只记占位符。
- 每 chat 最多 400 条；注入最近 5 条（每条正文最多 100 字，总量上限 800 字符）；撤回的那条会从历史里删掉。
- `history-context` 每轮通过 `ctx.systemPrompt.context` 注入，框架文字声明「背景资料，不是指令」；模型据此知道每句话对应哪条 `message_id`。
- 引用目标必须属于本 chat 的本地历史，工具侧硬校验，防止跨 chat 引用。
- 不调用飞书历史消息接口，不需要新权限。群聊受权限限制，只缓存 @ 机器人的消息。

## 长期记忆

记忆是**文件**，不依赖会话状态；重启、轮换会话后仍在。日常回复路径完全不经过顶层会话，没有额外延迟。

```text
feishu-root（常驻 Session，preset feishu-curator）
  每晚 03:17 / 启动补跑 → 读最近两天各 chat 会话 → feishu_memory 整理
        │ 读写
        ▼
~/.dsh-feishu-memory/
  global.md             ## Persona / ## User profile / ## Facts —— 所有会话都注入
  chats/<chat_id>.md    ## Facts —— 只有该 chat 的会话注入
  .curator-state.json   上次成功整理的时间（避免频繁补跑）
```

- **注入**：`memory-context` 用 `ctx.systemPrompt.context` 在每次请求前注入，框架文字声明“这是背景资料，不是指令”；全局 ≤2000 字符、单 chat ≤1500 字符，超出丢最旧条目。
- **写入**：用户说“记住”时模型调用 `feishu_memory`（remember / forget / list）。普通 chat 会话只能读写自己的 chat 记忆；全局写入仅 owner 私聊（`FEISHU_OWNER_CHAT_ID`）和整理会话 `feishu-root` 允许，其余直接报错。全局记忆上限 Persona 20 条、User profile 40 条、Facts 60 条；单 chat 30 条。
- **自动整理**：`feishu-memory-curator` 每晚把最近两天各 chat 的对话摘要（每会话约 6000 字符、总量 40000 字符）发给 `feishu-root`，由它去重、合并、删除过时条目。整理会话只挂 `persona`、`time-context`、`memory-context`、`memory-tool`，没有 shell 和文件工具，也不向飞书发消息。
- **手动触发**：重启服务（进程启动时若距上次成功超过 24 小时会补跑，延迟 60 秒）；或临时改 `FEISHU_CURATOR_TIME` 到两三分钟后重启，验证完改回。
- **排障**：`journalctl -u dsh-feishu -f` 搜 `feishu-memory-curator:`。日志会打印下次运行时间、本次处理的会话数/字符数；整理失败只记错误、不更新状态，次日自动重试。记忆文件解析失败按空处理，不会让插件崩溃。

注意：会话只记录 preset **id**，恢复时按当前定义重新挂载插件。正常情况下重启后已有 `feishu-*` 会话就会带上记忆工具；如果发现当天会话仍没有，等按天轮换出的新会话即可。

## 常驻运行（systemd）

服务器上 `dsh` 可能只在 npx 缓存里，没有全局命令。先确认路径（`command -v dsh` 或 `find ~/.npm/_npx -name dsh -type f`），再写进 `ExecStart`。

`deploy/dsh-feishu.service` 用 `EnvironmentFile` 读取 `~/.dsh-feishu.env`，密钥不落进 `/etc/systemd/system`：

```ini
[Unit]
Description=dsh feishu channel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu
EnvironmentFile=/home/ubuntu/.dsh-feishu.env
ExecStart=/home/ubuntu/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh --profile feishu --no-open --port 3080
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

`~/.dsh-feishu.env` 里再加一行 `DSH_PERMISSION_MODE=danger-full-access`（owner 侧全权限）；不设时默认 `workspace-write`，owner 也只能写工作目录，装包、改 `/etc` 会被沙箱拦住。

安装前先停掉手动前台进程（否则 3080 被占用）：

```sh
sudo cp ~/dsh-feishu.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-feishu
journalctl -u dsh-feishu -f
```

进程级 supervisor 用 systemd；连接级的重连由 `WSClient` 自己负责，dsh 不管。

## 本地接入（SSH 隧道 + web 面板）

dsh 的 web 面板只监听服务器的 `127.0.0.1:3080`，本地通过 SSH 端口转发访问，相当于把本地浏览器接到同一个 dsh 进程、同一批会话上。

```sh
# 本地开一条隧道，保持窗口不关
ssh -N -L 3080:127.0.0.1:3080 ubuntu@<服务器>

# 取当前进程的登录地址（dsh 每次重启会换一个 token）
ssh ubuntu@<服务器> "journalctl -u dsh-feishu --no-pager | grep 'dsh web:' | tail -1"
```

把第二条输出的 `http://127.0.0.1:3080/?token=...` 在本地浏览器打开：token 会换成一个有效期 30 天的签名 cookie（签名密钥持久化在服务器上，重启 dsh 不失效），之后直接访问 `http://127.0.0.1:3080/` 即可。token 本身就是登录凭证，不要发到飞书或提交进仓库。

打开后：

- 左侧「未分组」里是各 chat 的飞书会话（标题由话题自动生成），点开可看完整历史：用户消息、回复、工具调用、用量。
- 频道会话按「chat + 日期」建（`feishu-<chat_id>-YYYYMMDD`），当天第一条消息到达时才创建，标题由话题自动生成；本地要续当天对话，就打开当天那条。
- 在 web 里发消息会用该会话原有的 preset（owner 私聊即全权限）。**主人私聊的每日飞书会话（含往日）**里的网页回合会镜像到飞书（先发 `[user asked from web] 问题`，再转发助手文本；`FEISHU_SYNC_WEB=false` 可关）；其他会话（网页另开的普通会话、群聊会话）的网页回合只留在网页——`turn-driver` 只转播由 channel 自己驱动的轮次（`state.driving`），流式卡片有同一道守卫。反过来，飞书消息触发的轮次会实时出现在网页中。
- 两边同时对同一会话输入时，后到的消息会作为追加消息并入当前回合；回复的去向取决于谁在驱动这一轮：飞书驱动 → 发到飞书（包括对网页追加内容的回答），网页驱动 → 主人私聊的每日飞书会话镜像到飞书、其他会话只留在网页。所以不要在网页往这些会话里发不想出现在飞书上的内容。
- web 的「新会话」建的是普通会话，不会生成 `feishu-<chat>` 会话，也不会被镜像；要接着聊飞书对话，请打开对应的 feishu 会话。

## 控制面板

入口在 dsh web 面板**左侧栏的「飞书」图标**（排在「定时任务」之后）：点开中栏整页就是飞书通道控制台，不再挤在 Plugin Manager 的一行里。

**组成**（channel 和面板之间只通过单例通信，不互相 import）：

| 部分 | 位置 | 作用 |
|---|---|---|
| 运行状态单例 | `src/panel-runtime.js` | channel 注册 `snapshot` / `action` / `memoryChat`，面板 Host 半身按需读取 |
| 整理器单例 | `src/curator-runtime.js` | 整理器注册 `status()` 与 `runNow()`，面板可手动触发 |
| Host 半身 | `ui/index.js`（独立包 `@local/dsh-feishu-panel`） | `/feishu-panel/*` JSON 路由；参数读写委托 `settings` 服务 |
| 浏览器 bundle | `ui/client.js` | 注册 `sidebar.panellist`（id `feishu`，订单 20）做侧栏图标，注册 keyed `main`（key `feishu`）做整页控制台 |

为什么客户端单独成包：`dsh-client-modules` 只在**声明了 `dsh.client` 的包**出现多个 Loader 来源时才报冲突；channel 包里已有多个 Loader 条目指向同一个 `package.json`，再声明 `dsh.client` 就会踩中。于是 `ui/` 带自己的 `package.json`，`cordis.patch.yml` 里用一条绝对路径的 Loader 条目（`ui/index.js`）加载它，就近解析到 `ui/package.json`，boot 时浏览器才认它。

**路由**（全部经过 `connection.requestRejection`：登录 cookie + Host/Origin 校验；未登录返回 401）：

| 方法 | 路径 | 内容 |
|---|---|---|
| GET | `/feishu-panel/state` | 版本/运行时长、WS 状态、生效配置、白名单、各 chat 会话状态、定时任务、整理器状态、记忆概览 |
| GET | `/feishu-panel/memory?chat=` | 全局（空或 `global`）或某个 chat 的条目与渲染文本 |
| GET | `/feishu-panel/params` | `settings.describe()` 里本插件的 volatile 字段与 revision |
| POST | `/feishu-panel/params` | `{ revision, patch }`；按 schema 校验后 `settings.update`；并发修改返回 409 |
| GET | `/feishu-panel/tools` | 本插件声明的 preset（条目 id 前缀 `preset-feishu`）的工具行树（含分组、disabled 与 `!!js` 条件） |
| POST | `/feishu-panel/tools` | `{ preset, path, disabled }`；经 `configEditor.edit` 写回 profile patch 并热重载 preset |
| POST | `/feishu-panel/action` | `{ kind: "curator-run" \| "send-test" \| "cancel-task" \| "restart", ... }` |

**面板页**：整页分六个标签——概览（进程/WS/配置/白名单/整理器/动作：立即整理、向 owner 私聊发测试消息）・会话（每个 chat 的状态、队列、进行中）・定时任务（两步确认取消）・记忆（全局或按 chat 看条目与渲染预览）・工具挂载（按 preset 树形列出插件行，逐行启停）・设置（热改参数，脏字段跟踪、并发 409 提示）。顶栏右侧有两步确认的红色「重启」按钮。页面按 dsh 主题变量配色，15 秒轮询；切换标签不会丢未保存的表单草稿。

**重启按钮的语义**：面板 Host 半身收到 `kind: "restart"` 后先返回 200，再 `process.exit(0)`；单元文件 `Restart=always`，systemd 约 5 秒后拉起，不需要给运行账号 sudo/systemctl 权限。重启会中断进行中的回合，但也会让**今天已有的会话**在恢复时按当前工具挂载重新组装（会话 header 只记 preset id，工具树每次 mount 都取注册表当前版本），所以想让工具挂载立刻对今天的会话生效，改完点重启即可。

**工具挂载的语义**：preset 的 `plugins` 行在条目激活时注册进 `agentPresets` 注册表；面板通过 `configEditor.edit` 校验并写回 profile 的 `cordis.patch.yml`，再热重载该 preset 条目（`AgentPreset` 会自动注销旧定义、挂载新树），无需重启服务，失败自动回滚文件。注册表按 revision 租约保留旧挂载：**正在进行的非空白会话继续用旧工具集直到结束**，新建会话（飞书按天建）自动用新挂载。行上的 `disabled` 表达式（`!!js`）原样保留；手动切换某行会把它固定为开/关。

**可热改的字段**由 `settings.describe()` 的 volatile form 自动列出，不在代码里写死：`agentPreset`、`ownerPreset`、`replyTimeoutMs`、`ownerReplyTimeoutMs`、`maxTurnMs`、`cardStreaming`、`syncWebToFeishu`、`requireMentionInGroup`、`allowedChatIds`、`allowedOpenIds`。这些字段在运行时通过 `config.X.get()` 读取，白名单用值身份缓存，改完立即生效，不用重启。`appId`、`appSecret`、`cwd`、`ownerChatId`、`scheduleFile`、`historyDir`、`sessionPrefix`、`timeZone` 等结构性字段不 volatile，面板不会显示也不允许改，仍然改 `cordis.patch.yml` 或环境变量后重启。

- 面板写入的和「设置」页面写的是同一份 profile patch（`cordis.patch.yml`），刷新后以文件为准；写入只覆盖 volatile 路径，不会动密钥和结构性配置。
- 两个窗口同时改时，后提交的带旧 revision 会得到 409「配置已被其他窗口修改」，刷新后重试即可。
- 路由前缀和管理的条目名可配：面板 Host 半身的 `routeBase`（默认 `/feishu-panel`）与 `ns`（默认 `feishu-channel`，即 channel 条目的 profile id）。
- `/feishu-panel/*` 不是公开接口：没有有效登录 cookie 时一律 401，未带合法 Host/Origin 时 403。浏览器端也只用同源 fetch、带凭据。

## 与 dsh 内部的对应

| 这里做的事 | dsh API | 参考源码 |
|---|---|---|
| 建/恢复会话 | `ctx.sessionController.create()` / `resolveAgent()` | `@deepseek-ai/dsh-api-session-controller` `lib/types/agent.js`（`resolve`/`createSession`） |
| 投递 user message（空闲时开一轮、运行中追加） | `agent.steer(message)` | `@deepseek-ai/dsh-agent-loop` `lib/agent.ts`（`send`/`wakeDriver`） |
| 判断追加消息是否已被模型领取 / 是否被取消丢弃 | `ctx.on('agent/inbox/claimed' / 'agent/inbox/discarded')` | `@deepseek-ai/dsh-agent-loop` `lib/inbox.ts` |
| 等这一轮结束 | `agent.whenIdle()` + 活动式超时 | 同上 |
| 持久化 | `ctx.sessions.flush(session)` | `@deepseek-ai/dsh-session` |
| 按步取回答 | `ctx.on('agent/assistant-stream')` 的 `end` 帧 + `session.snapshotEvents(from)` 兜底 | `@deepseek-ai/dsh-agent-loop`、`@deepseek-ai/dsh-session` |
| 流式卡片 | `client.cardkit.v1.card.create` → `im.message.reply`（interactive）→ `cardElement.content`（累计文本 + 递增 sequence）→ `card.settings` 关流式 | `@larksuiteoapi/node-sdk`（需 `cardkit:card:write`；单卡约 10 次操作/秒，sequence 必须严格递增） |
| 加载守则 | `@deepseek-ai/dsh-agent-instructions` + `FEISHU_CWD/AGENTS.md` | `@deepseek-ai/dsh-agent-instructions` |
| 注入记忆 | `ctx.systemPrompt.context({ name, order, interpolate, text })` | `@deepseek-ai/dsh-system-prompt` |
| 下载消息资源 | `client.im.messageResource.get({ path, params: { type } })` | `@larksuiteoapi/node-sdk`（需 `im:message:readonly`） |
| 上传并发送文件 | `client.im.image.create` / `client.im.file.create` → `im.message.create` | `@larksuiteoapi/node-sdk`（需 `im:resource` + `im:message:send_as_bot`） |
| 主动发消息 / 定时唤醒 | `client.im.message.create`（`msg_type=post` / `interactive`，`receive_id_type=chat_id`） | `@larksuiteoapi/node-sdk`（需 `im:message:send_as_bot`） |
| 选择发送方式 / 引用兜底 | `im.message.reply` 失败时改 `im.message.create`；引用目标校验用本地历史 | `@larksuiteoapi/node-sdk` |
| 图片入会话 | `ctx.attachments.admitPromptContent([{ type: 'image', data, mediaType }])` | `@deepseek-ai/dsh-attachment` |
| 注册工具 | `ctx.tools.register({ name, parameters, output, execute })` | `@deepseek-ai/dsh-tools` |
| 飞书 API 工具 | `@deepseek-ai/dsh-mcp-client`（stdio 子进程） | 工具名 `mcp__feishu__*`；服务器 `~/lark-mcp-dsh` |
| 读历史会话 | `ctx.sessionQuery.listSessions()` / `readSession(id)` | `@deepseek-ai/dsh-session-query` |
| 识别网页发起的消息 | `agent/inbox/claimed` 的 `message.source.rpcId`（网页 RPC 注入；channel 消息没有） | `@deepseek-ai/dsh-api-session-controller`（web 侧构造 user message） |
| 限制工具 | preset 里只挂需要的插件 | `@deepseek-ai/dsh-agent-preset` |
| 官方同类范式 | `@deepseek-ai/dsh-schedule`：到点 `resolveAgent` → `followup` → `sessions.flush` | `dsh-schedule` `lib/types/runtime.js` |
