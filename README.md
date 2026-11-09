# feishu-channel

把 dsh 变成常驻的飞书机器人：**WS 长连接收消息 → 白名单过滤 → 按 chat 路由到独立 Session → 在本进程里跑一轮 agent → 把回答发回飞书**。
不经过 MCP，不轮询，不需要 `dsh-headless` 子进程。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 插件：`apply(ctx, config)` 里起 `WSClient`，事件回调里 `agent.followup(...)` + `agent.whenIdle()`，并监听 `agent/assistant-stream` 按步发消息；附件下载、归档与格式判定也在这里 |
| `memory-store.js` | 记忆存储层：Markdown 文件、原子写、mtime 缓存、条数/字节上限 |
| `memory-context.js` | Preset 插件：每回合注入全局记忆 + 当前 chat 记忆（只读） |
| `memory-tool.js` | Preset 插件：注册 `feishu_memory` 工具，作用域守卫硬编码 |
| `memory-curator.js` | Host 插件：每晚把最近会话摘要交给 `feishu-root` 整理写入 |
| `cordis.patch.yml` | bundle patch：channel 插件 + 记忆整理插件 + 两个 agent preset（`feishu` / `feishu-curator`） |
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
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 是 | 飞书自建应用凭据；需在开放平台开启「长连接」并订阅 `im.message.receive_v1`；下载图片/文件还需要 `im:resource` 权限 |
| `FEISHU_CWD` | 否 | 每个 Session 的工作目录；`AGENTS.md` 就放在这里 |
| `FEISHU_ALLOWED_CHAT_IDS` | 是（否则不接收） | 允许的群聊 chat_id，英文逗号分隔 |
| `FEISHU_ALLOWED_OPEN_IDS` | 是（否则不接收） | 允许私聊的用户 open_id，英文逗号分隔 |
| `FEISHU_MEMORY_DIR` | 否 | 记忆目录，默认 `~/.dsh-feishu-memory` |
| `FEISHU_OWNER_CHAT_ID` | 否 | 主人私聊的 chat_id；该 chat 使用 `feishu-power` preset，并且只有它可以写全局记忆 |
| `DSH_PERMISSION_MODE` | 否 | `danger-full-access` 时 owner 会话等同本机 agent（无审批、可写任意目录）；默认 `workspace-write`，系统目录只读 |
| `FEISHU_CURATOR_TIME` | 否 | 每晚整理时间 `HH:MM`，默认 `03:17`（`Asia/Shanghai`） |
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
| owner 私聊（`FEISHU_OWNER_CHAT_ID`） | `feishu-power` | bash / 文件读写 / 文件搜索 / 联网 / 后台任务 / todo / skill / 子代理 + 记忆 + 压缩 |
| 群聊、其他私聊 | `feishu` | 只有对话 + 记忆，没有任何执行工具 |
| `feishu-root`（记忆整理） | `feishu-curator` | 只有记忆工具 |

- owner 侧配上 `DSH_PERMISSION_MODE=danger-full-access` 后，沙箱全关、审批永不打断，能力等同旧 CC bot；不设则默认 `workspace-write`，写系统目录会被沙箱拦住。
- **安全边界要认清**：owner 和群聊共用同一个 dsh 进程、同一个 `ubuntu` 账号。群聊之所以安全，是因为它的 preset 里根本没有工具，而不是沙箱挡住了什么。以后群聊机器人也要工具时，必须拆成独立实例 + 独立系统账号（`dsh-group`），不能只在一个 preset 里放开。
- owner 会话里模型理论上能读到自己进程的密钥（它要拿 app secret 连飞书），和旧 CC bot 相同；约束靠 `POWER.md` 的密钥规则和「只有 owner 私聊能触发这个 preset」。
- preset 在会话创建时固定：部署后当天已存在的 `feishu-*` 会话仍用旧 preset，第二天按天轮换自动生效；想立刻验证可以停掉服务后把当天对应会话目录移走（`~/.dsh/sessions/--home-ubuntu-feishu-workspace--/<session-id>`），再启动。日志里 `created session ... preset=feishu-power` 表示新会话用上了 owner preset。

## 会话与行为

- **一个 chat 一个 Session，按天轮换**：session id = `feishu-<chat_id>-<YYYYMMDD>`，默认按 `Asia/Shanghai` 切日。第二天自动新建会话，历史不会再滚进新上下文；旧 Session 仍在磁盘上，可按 id 恢复。
- **白名单默认拒绝**：私聊按发送者 open_id 判断，群聊按 chat_id 判断；不在名单里的消息只记一行日志。
- **群聊默认要 @ 机器人**（`requireMentionInGroup`），并且只申请 `im:message.group_at_msg:readonly` 权限，非 @ 消息不会推过来。
- **去重**：按 `message_id` 记最近 1000 条，WS 重连时飞书重投的旧事件不会重复触发。
- **超时会中止**：一轮超过 `replyTimeoutMs`（普通 chat 默认 180s，owner 私聊默认 900s）就 `agent.cancel` 并回一句超时提示，避免答案拖到下一轮、白烧 token。
- **支持文本、富文本、图片、文件、语音、视频**：图片作为原生 image block 交给模型直接看；owner 私聊的附件统一落盘并给路径，群聊维持内联/描述。详见下一节。
- **按步分条发送**：模型每提交一条 `assistant/message`，其中带文字的内容就立刻作为一条独立消息发回，最后一条天然是总结；只有工具调用、没有文字的步骤不发。仍然不是 token 级流式（不会边打字边显示），但多步回合能逐步看到进展。实现见 `index.js` 里对 `agent/assistant-stream` 的 `end` 帧监听，末尾再用 `snapshotEvents` 扫一遍防止漏发。
- 所有回复走 `im.message.reply`，`msg_type=post` + `md` 节点，飞书按 CommonMark/GFM 渲染 Markdown（标题、列表、表格、代码块等）；飞书里表现为「引用原消息再回复」。post 整条上限 30KB，超过 3500 字符自动拆条。想要普通消息，改用 `im.message.create` 发到 chat_id。
- **超时收尾**：超时取消后会短暂等待落盘（最多 5 秒），把取消前已生成的部分文本也发出来，再发超时提示。
- 这是**单进程**方案：进程内的所有 chat 并行，但同一 chat 串行（插件内的 promise 链 + dsh inbox 的 `next-turn` 队列）。

## 媒体输入

| 飞书消息类型 | 处理方式 |
|---|---|
| `text` | 原文，并还原 @ 占位符 |
| `post`（富文本） | 拼回纯文本；内嵌图片逐张下载后作为 image block（群聊里 @ + 图片的常见形态） |
| `image` | `im.messageResource.get` 下载 → 校验 png/jpeg/webp/gif → `ctx.attachments.admitPromptContent` 转 durable 引用 → 作为原生 image block 放进 user message（模型直接看图）；同时归档到历史目录 |
| `file` | 先下载归档。owner 私聊直接给绝对路径，由 power preset 用命令处理；群聊维持：图片文件转 image block（≤20MB），文本类内联开头 64KB，其余只给文件名/大小 |
| `audio` / `media` | owner 私聊下载归档并给路径；群聊只生成一句说明 |
| `merge_forward` | 只生成一句说明（当前不能展开），由模型如实回复 |

- 所有下载到的附件统一存到 `~/feishu-history/files`（目录 0700、文件 0600），文件名为 `消息id-序号-净化后的原名`；**插件不自动清理**，磁盘由使用者负责。
- 上限：普通文件/语音/视频 50MB，流式写盘不占内存；图片 20MB（`dsh-attachment-local` 的单图上限）。超限时删除半成品并降级成文字说明；群聊文本文件最多内联开头 64KB。
- owner 私聊不再把文本文件内联进消息，只给路径，模型按需读取。PDF/Office/压缩包/音视频能否解析取决于服务器装了哪些工具（pdftotext、libreoffice、ffmpeg 等），模型会先检查再回答，没有就如实说明。
- 群聊仍然只接收 @ 消息，所以群里单独发的图片不会被推送；群里要带图，用「@ + 图片」的富文本（post），私聊直接发图片即可。
- 图片能看的前提是模型路由声明了 image 输入；`dsh-base` 默认的 `deepseek-flash` 支持。换成纯文本模型时图片会退化成占位提示。
- App 需要在开放平台开通 `im:resource`（获取与上传图片或文件资源），否则下载资源会报权限错误。
- 图片字节存入 dsh 的 attachment 存储，会话日志里只记引用；`~/feishu-history/files` 是插件自己的归档副本。

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

## 与 dsh 内部的对应

| 这里做的事 | dsh API | 参考源码 |
|---|---|---|
| 建/恢复会话 | `ctx.sessionController.create()` / `resolveAgent()` | `@deepseek-ai/dsh-api-session-controller` `lib/types/agent.js`（`resolve`/`createSession`） |
| 追加一条 user message 并触发回合 | `agent.followup(message)` | `@deepseek-ai/dsh-agent-loop` `lib/index.js`（`followup`/`send`/`wakeDriver`） |
| 等这一轮结束 | `agent.whenIdle()` | 同上 |
| 持久化 | `ctx.sessions.flush(session)` | `@deepseek-ai/dsh-session` |
| 按步取回答 | `ctx.on('agent/assistant-stream')` 的 `end` 帧 + `session.snapshotEvents(from)` 兜底 | `@deepseek-ai/dsh-agent-loop`、`@deepseek-ai/dsh-session` |
| 加载守则 | `@deepseek-ai/dsh-agent-instructions` + `FEISHU_CWD/AGENTS.md` | `@deepseek-ai/dsh-agent-instructions` |
| 注入记忆 | `ctx.systemPrompt.context({ name, order, interpolate, text })` | `@deepseek-ai/dsh-system-prompt` |
| 下载消息资源 | `client.im.messageResource.get({ path, params: { type } })` | `@larksuiteoapi/node-sdk`（需 `im:resource`） |
| 图片入会话 | `ctx.attachments.admitPromptContent([{ type: 'image', data, mediaType }])` | `@deepseek-ai/dsh-attachment` |
| 注册工具 | `ctx.tools.register({ name, parameters, output, execute })` | `@deepseek-ai/dsh-tools` |
| 读历史会话 | `ctx.sessionQuery.listSessions()` / `readSession(id)` | `@deepseek-ai/dsh-session-query` |
| 限制工具 | preset 里只挂需要的插件 | `@deepseek-ai/dsh-agent-preset` |
| 官方同类范式 | `@deepseek-ai/dsh-schedule`：到点 `resolveAgent` → `followup` → `sessions.flush` | `dsh-schedule` `lib/types/runtime.js` |
