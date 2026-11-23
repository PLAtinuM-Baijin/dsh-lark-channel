/**
 * 飞书面板的浏览器半身。
 *
 * 注册两个客户端 slot：
 *   sidebar.panellist  id=feishu    左栏图标（点击切到整页）
 *   main               key=feishu   占满中栏的控制台页面
 *
 * 数据来自同源 /feishu-panel/* 路由，登录态沿用 dsh 的 HttpOnly cookie。
 * 这是无构建步骤的 bundle：只用 React.createElement，不依赖其他客户端包。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-feishu-panel',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const BASE = '/feishu-panel'
    const PANEL_ID = 'feishu'
    const PANEL_LABEL = '飞书'
    const POLL_MS = 15000
    const STYLE_ID = 'dsh-feishu-panel-styles'

    const WS_META = {
      starting: { label: '连接中', tone: 'warn', pulse: true },
      running: { label: '已连接', tone: 'success', pulse: true },
      error: { label: '连接失败', tone: 'error', pulse: false },
      stopped: { label: '已停止', tone: 'idle', pulse: false },
    }

    const SESSION_STATUS = {
      idle: '空闲',
      running: '运行中',
      error: '异常',
      stopped: '已停止',
      queued: '排队中',
      compacting: '压缩中',
    }

    const FIELD_META = {
      agentPreset: {
        label: '群聊 / 私聊 Preset',
        desc: '群聊和普通私聊使用的 agent preset。',
      },
      ownerPreset: {
        label: '主人 Preset',
        desc: '主人私聊使用的 agent preset。',
      },
      replyTimeoutMs: {
        label: '普通回复超时',
        desc: '群聊和普通私聊等待一轮回复的超时时间。',
      },
      ownerReplyTimeoutMs: {
        label: '主人回复超时',
        desc: '主人私聊等待一轮回复的超时时间。',
      },
      maxTurnMs: {
        label: '单轮上限',
        desc: '单个回合允许运行的最长时间。',
      },
      cardStreaming: {
        label: '流式卡片',
        desc: '用流式卡片逐步展示回答；卡片失败时自动退回普通消息。',
      },
      syncWebToFeishu: {
        label: '网页回合镜像',
        desc: '把网页里对主人飞书会话发起的回合同步到飞书。',
      },
      requireMentionInGroup: {
        label: '群聊仅 @ 响应',
        desc: '群聊里只在 @ 机器人时处理消息。',
      },
      allowedChatIds: {
        label: '群聊白名单',
        desc: '允许接收消息的群聊 chat_id，每行一个。',
      },
      allowedOpenIds: {
        label: '私聊白名单',
        desc: '允许私聊的用户 open_id，每行一个。',
      },
    }

    const TOOL_META = {
      '@deepseek-ai/dsh-tool-bash': { label: 'Shell 命令', desc: '在服务器上执行命令。' },
      '@deepseek-ai/dsh-tool-fs': { label: '文件读写', desc: '读、写、编辑服务器文件。' },
      '@deepseek-ai/dsh-tool-fs-search': { label: '文件搜索', desc: '按名称或内容搜索文件。' },
      '@deepseek-ai/dsh-tool-jobs': { label: '后台任务', desc: '启动与查看后台作业。' },
      '@deepseek-ai/dsh-tool-todo': { label: '待办清单', desc: '维护多步任务的待办列表。' },
      '@deepseek-ai/dsh-tool-web': { label: '网页搜索', desc: '搜索网页与抓取链接内容。' },
      '@deepseek-ai/dsh-skill-filesystem': { label: '技能发现', desc: '扫描可用的技能目录。' },
      '@deepseek-ai/dsh-tool-skill': { label: '技能调用', desc: '加载并执行技能。' },
      '@deepseek-ai/dsh-mcp-client': { label: '飞书 MCP', desc: '文档、日历、任务、wiki、通讯录等 MCP 工具。' },
      '@deepseek-ai/dsh-agent-instructions': { label: '守则加载', desc: '读取 AGENTS.md / POWER.md 注入系统提示。' },
      '@deepseek-ai/dsh-persona': { label: '人格前缀', desc: '注入固定的人格与语气。' },
      '@deepseek-ai/dsh-time-context': { label: '时间上下文', desc: '注入当前时间与时区。' },
      '@deepseek-ai/dsh-compaction-basic': { label: '上下文压缩', desc: '长会话的自动压缩后端。' },
      '@deepseek-ai/dsh-compaction-tool-result-pruner': { label: '工具结果修剪', desc: '截断过长的工具结果。' },
      '@deepseek-ai/dsh-tool-subagent-control': { label: '子代理控制', desc: '创建、查看子代理。' },
      '@deepseek-ai/dsh-tool-subagent-control/list-agents': { label: '子代理列表', desc: '列出可用的子代理。' },
      '@deepseek-ai/dsh-tool-subagent': { label: '子代理', desc: '分派任务给子代理。' },
      '@deepseek-ai/dsh-workflow-ptc': { label: '工作流引擎', desc: '运行 workflow 脚本。' },
      '@deepseek-ai/dsh-tool-workflow': { label: '工作流工具', desc: '创建与推进工作流。' },
      '@local/dsh-feishu-channel/memory-context': { label: '记忆注入', desc: '每轮注入全局与本 chat 的记忆。' },
      '@local/dsh-feishu-channel/memory-tool': { label: '记忆读写', desc: 'feishu_memory 工具。' },
      '@local/dsh-feishu-channel/history-context': { label: '聊天历史注入', desc: '注入最近聊天记录与 message_id。' },
      '@local/dsh-feishu-channel/reply-tool': { label: '引用回复', desc: '选择引用某条消息回复。' },
      '@local/dsh-feishu-channel/send-file': { label: '发送文件', desc: '把服务器文件发回飞书。' },
      '@local/dsh-feishu-channel/send-text': { label: '发送文本', desc: '主动发一条新消息。' },
      '@local/dsh-feishu-channel/schedule-tool': { label: '定时任务工具', desc: '创建与管理定时提醒。' },
    }

    const GROUP_META = {
      compaction: { label: '上下文压缩后端' },
      delegation: { label: '子代理与工作流' },
    }

    const CSS = `
.fsp-root{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.fsp-root,.fsp-root *{box-sizing:border-box}
.fsp-root button{font-family:inherit}
.fsp-root :focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:2px}
.fsp-header{flex:none;display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:24px clamp(24px,4vw,48px) 14px;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 5%,transparent),transparent)}
.fsp-brand{display:flex;align-items:center;gap:14px;min-width:0}
.fsp-logo{width:44px;height:44px;border-radius:15px;display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--dsw-alias-state-business-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 20%,transparent)}
.fsp-brand-text{min-width:0}
.fsp-title{margin:0;font-size:21px;font-weight:600;line-height:28px;letter-spacing:-.01em}
.fsp-subtitle{margin:2px 0 0;font-size:12.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fsp-header-right{margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.fsp-updated{font-size:11.5px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.fsp-header-error{max-width:240px;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fsp-status{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 11px;border-radius:14px;font-size:12.5px;font-weight:500;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);white-space:nowrap}
.fsp-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 15%,transparent)}
.fsp-tone-success{color:var(--dsw-alias-state-success-primary,#2a8a4a)}
.fsp-tone-warn{color:var(--dsw-alias-state-warn-primary,#b7791f)}
.fsp-tone-error{color:var(--dsw-alias-state-error-primary,#d33)}
.fsp-tone-accent{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.fsp-tone-idle{color:var(--dsw-alias-label-tertiary)}
.fsp-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;height:24px;padding:0 9px;border-radius:12px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);white-space:nowrap}
.fsp-chip.fsp-tone-success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2a8a4a) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2a8a4a) 24%,transparent)}
.fsp-chip.fsp-tone-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b7791f) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b7791f) 24%,transparent)}
.fsp-chip.fsp-tone-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d33) 9%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d33) 22%,transparent)}
.fsp-chip.fsp-tone-accent{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 22%,transparent)}
.fsp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 13px;border-radius:16px;border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
.fsp-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.fsp-btn:disabled{opacity:.5;cursor:default}
.fsp-btn.primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff;border-color:transparent}
.fsp-btn.primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.fsp-btn.danger{color:var(--dsw-alias-state-error-primary,#d33);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d33) 30%,transparent)}
.fsp-btn.danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d33) 9%,transparent)}
.fsp-btn.danger-solid{background:var(--dsw-alias-state-error-primary,#d33);color:#fff;border-color:transparent}
.fsp-btn.danger-solid:hover:not(:disabled){filter:brightness(1.08);background:var(--dsw-alias-state-error-primary,#d33)}
.fsp-btn.sm{height:28px;padding:0 10px;font-size:12px;border-radius:14px}
.fsp-btn svg{flex:none}
.fsp-tabs{flex:none;display:flex;gap:4px;padding:0 clamp(24px,4vw,48px);border-bottom:.5px solid var(--dsw-alias-border-l3);overflow-x:auto;scrollbar-width:none}
.fsp-tabs::-webkit-scrollbar{display:none}
.fsp-tab{position:relative;display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 11px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:13px;font-weight:500;cursor:pointer;border-radius:10px 10px 0 0;white-space:nowrap;transition:background .15s,color .15s}
.fsp-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.fsp-tab[data-active=true]{color:var(--dsw-alias-label-primary)}
.fsp-tab[data-active=true]:after{content:"";position:absolute;left:9px;right:9px;bottom:-.5px;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.fsp-tab-count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
.fsp-tab[data-active=true] .fsp-tab-count{color:var(--dsw-alias-state-business-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 10%,transparent)}
.fsp-body{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.fsp-content{width:100%;max-width:1120px;margin:0 auto;padding:26px clamp(24px,4vw,48px) 16px;display:flex;flex-direction:column;gap:18px}
.fsp-tabpanel{display:contents}
.fsp-tabpanel[hidden]{display:none!important}
.fsp-stack{display:flex;flex-direction:column;gap:18px;min-width:0;animation:fsp-fade .18s ease}
.fsp-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.fsp-stat{min-width:0;display:flex;flex-direction:column;gap:5px;padding:16px 18px;border-radius:16px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);transition:border-color .15s}
.fsp-stat:hover{border-color:var(--dsw-alias-border-l2)}
.fsp-stat-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.fsp-stat-label{font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:500}
.fsp-stat-icon{color:var(--dsw-alias-label-caption);display:inline-flex}
.fsp-stat-value{display:flex;align-items:center;gap:8px;font-size:24px;font-weight:600;line-height:1.15;letter-spacing:-.02em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fsp-stat-note{font-size:11.5px;color:var(--dsw-alias-label-caption);line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fsp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:stretch}
.fsp-card{min-width:0;display:flex;flex-direction:column;gap:12px;padding:18px 20px;border-radius:16px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3)}
.fsp-card.wide{grid-column:1/-1}
.fsp-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.fsp-card-title{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;line-height:20px}
.fsp-card-title>svg{color:var(--dsw-alias-label-tertiary);flex:none}
.fsp-card-desc{margin:-2px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.6}
.fsp-kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:9px 18px;margin:0;font-size:12.5px;align-content:start}
.fsp-kv dt{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.fsp-kv dd{margin:0;color:var(--dsw-alias-label-primary);min-width:0;overflow-wrap:anywhere}
.fsp-inline-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.fsp-subgroup{display:flex;flex-direction:column;gap:7px}
.fsp-subtitle-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:500}
.fsp-count-pill{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 7px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:500;white-space:nowrap}
.fsp-ids{display:flex;flex-wrap:wrap;gap:6px}
.fsp-id-chip{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 7px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l4);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}
.fsp-muted{color:var(--dsw-alias-label-tertiary)}
.fsp-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.6}
.fsp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}
.fsp-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.fsp-inline-msg{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1.6}
.fsp-inline-msg svg{flex:none}
.fsp-alert{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.6;border:.5px solid transparent}
.fsp-alert svg{flex:none;margin-top:1px}
.fsp-alert.error{color:var(--dsw-alias-state-error-primary,#d33);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d33) 7%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d33) 20%,transparent)}
.fsp-alert.warn{color:var(--dsw-alias-state-warn-primary,#b7791f);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b7791f) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b7791f) 22%,transparent)}
.fsp-alert.info{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l3)}
.fsp-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap}
.fsp-h2{margin:0;font-size:15px;font-weight:600;line-height:22px}
.fsp-desc{margin:4px 0 0;font-size:12.5px;color:var(--dsw-alias-label-tertiary);line-height:1.65;max-width:720px}
.fsp-sessions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.fsp-session{min-width:0;display:flex;flex-direction:column;gap:10px;padding:16px 18px;border-radius:16px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3)}
.fsp-session-head{display:flex;align-items:center;gap:11px;min-width:0}
.fsp-avatar{width:36px;height:36px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex:none;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.fsp-avatar.owner{color:var(--dsw-alias-state-business-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 11%,transparent)}
.fsp-avatar.group{color:var(--dsw-alias-state-success-primary,#2a8a4a);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2a8a4a) 11%,transparent)}
.fsp-session-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.fsp-session-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fsp-session-kind{font-size:13px;font-weight:600}
.fsp-session-id{padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.fsp-session-meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.fsp-session-meta b{font-weight:600;color:var(--dsw-alias-label-secondary)}
.fsp-tasks{display:flex;flex-direction:column;gap:12px}
.fsp-task{display:flex;flex-direction:column;gap:10px;padding:16px 18px;border-radius:16px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);min-width:0}
.fsp-task-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.fsp-task-when{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary)}
.fsp-task-when>svg{flex:none}
.fsp-task-next{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.fsp-task-prompt{margin:0;padding:11px 13px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l4);font-family:inherit;font-size:12.5px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;color:var(--dsw-alias-label-primary)}
.fsp-task-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.fsp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:56px 24px;border-radius:16px;border:.5px dashed var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}
.fsp-empty-glyph{width:46px;height:46px;border-radius:15px;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);margin-bottom:2px}
.fsp-empty h3{margin:0;font-size:14px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.fsp-empty p{margin:0;max-width:460px;font-size:12.5px;line-height:1.65}
.fsp-empty .fsp-btn{margin-top:8px}
.fsp-loading{min-height:320px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--dsw-alias-label-tertiary);font-size:13px}
.fsp-spinner{width:20px;height:20px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary,#4d6bfe);animation:fsp-spin .8s linear infinite;flex:none}
.fsp-spinner-sm{width:12px;height:12px;border-width:1.5px;border-top-color:currentColor}
.fsp-memory{display:grid;grid-template-columns:250px minmax(0,1fr);gap:12px;align-items:start}
.fsp-scopes{display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:16px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);max-height:560px;overflow:auto}
.fsp-scope-head{padding:6px 10px 8px;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-caption)}
.fsp-scope{display:flex;flex-direction:column;gap:1px;width:100%;padding:8px 10px;border:0;border-radius:10px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.fsp-scope:hover{background:var(--dsw-alias-interactive-bg-hover)}
.fsp-scope[data-active=true]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 10%,transparent)}
.fsp-scope[data-active=true] .fsp-scope-name{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.fsp-scope-name{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.fsp-scope-meta{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.fsp-memory-detail{min-height:280px}
.fsp-memory-groups{display:flex;flex-direction:column;gap:16px}
.fsp-memory-group{display:flex;flex-direction:column;gap:2px}
.fsp-memory-group-title{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.fsp-entry{display:flex;align-items:flex-start;gap:12px;padding:7px 0;border-top:.5px solid var(--dsw-alias-border-l4)}
.fsp-memory-group-title + .fsp-entry{border-top:0}
.fsp-entry-date{flex:none;width:82px;padding-top:1px;font-size:11px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.fsp-entry-text{font-size:12.5px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
.fsp-details{border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:9px 12px}
.fsp-details summary{cursor:pointer;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.fsp-details pre{margin:9px 0 0;max-height:280px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.fsp-settings{padding-bottom:16px}
.fsp-fields{display:flex;flex-direction:column}
.fsp-field{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,340px);gap:20px;align-items:start;padding:14px 0;border-top:.5px solid var(--dsw-alias-border-l4)}
.fsp-field:first-child{border-top:0;padding-top:2px}
.fsp-field-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:600;line-height:20px}
.fsp-field-code{padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;font-weight:400;line-height:18px}
.fsp-field-help{margin:3px 0 0;font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.55;max-width:520px}
.fsp-field-default{margin:2px 0 0;font-size:11px;color:var(--dsw-alias-label-caption)}
.fsp-field-control{display:flex;flex-direction:column;gap:5px;justify-self:end;width:100%}
.fsp-input{width:100%;height:34px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;outline:none;transition:border-color .15s,box-shadow .15s}
.fsp-input:hover{border-color:var(--dsw-alias-border-l2)}
.fsp-input:focus{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 14%,transparent)}
.fsp-input:focus-visible{outline:none}
.fsp-input::placeholder{color:var(--dsw-alias-label-caption)}
.fsp-textarea{height:auto;min-height:78px;padding:9px 10px;resize:vertical;line-height:1.6}
.fsp-control-hint{font-size:11px;color:var(--dsw-alias-label-caption);line-height:1.5}
.fsp-switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;user-select:none;align-self:flex-start;position:relative;padding:3px 0}
.fsp-switch input{position:absolute;width:1px;height:1px;opacity:0}
.fsp-switch-track{position:relative;flex:none;width:38px;height:22px;border-radius:11px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.25));transition:background .18s}
.fsp-switch-track:after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s}
.fsp-switch input:checked + .fsp-switch-track{background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.fsp-switch input:checked + .fsp-switch-track:after{transform:translateX(16px)}
.fsp-switch input:focus-visible + .fsp-switch-track{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:2px}
.fsp-switch-text{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:2.2em}
.fsp-savebar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:6px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l3)}
.fsp-save-note{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.fsp-action-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.fsp-action-row .fsp-input{flex:1;min-width:220px;width:auto}
.fsp-tools{display:flex;flex-direction:column;gap:14px}
.fsp-tool-rows{display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l4)}
.fsp-tool-row{display:flex;align-items:flex-start;gap:11px;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l4);min-width:0}
.fsp-tool-row.off .fsp-tool-name{color:var(--dsw-alias-label-tertiary)}
.fsp-tool-row.off .fsp-tool-mod{opacity:.55}
.fsp-tool-row.dim{opacity:.55}
.fsp-tool-switch{align-self:center;padding:0;flex:none}
.fsp-tool-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.fsp-tool-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fsp-tool-name{font-size:13px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
.fsp-tool-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.fsp-tool-mod{font-size:10.5px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.fsp-tool-children{display:flex;flex-direction:column;margin-left:19px;padding-left:15px;border-left:1px solid var(--dsw-alias-border-l3)}
.fsp-tool-cond{font-size:10.5px;color:var(--dsw-alias-label-caption)}
@keyframes fsp-spin{to{transform:rotate(360deg)}}
@keyframes fsp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes fsp-fade{from{opacity:0}to{opacity:1}}
.fsp-spin{animation:fsp-spin .8s linear infinite}
.fsp-pulse{animation:fsp-pulse 2.2s ease-in-out infinite}
@media (max-width:1100px){.fsp-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:960px){.fsp-grid{grid-template-columns:minmax(0,1fr)}.fsp-sessions{grid-template-columns:minmax(0,1fr)}.fsp-memory{grid-template-columns:minmax(0,1fr)}.fsp-scopes{max-height:260px}}
@media (max-width:760px){.fsp-header{padding:20px 20px 12px;gap:12px}.fsp-tabs{padding:0 20px}.fsp-content{padding:22px 20px 16px}.fsp-header-right{width:100%;margin-left:0}.fsp-field{grid-template-columns:minmax(0,1fr);gap:8px}.fsp-field-control{justify-self:stretch}.fsp-entry{flex-direction:column;gap:2px}.fsp-entry-date{width:auto}}
@media (prefers-reduced-motion:reduce){.fsp-stack,.fsp-spin,.fsp-pulse{animation:none}}
`

    async function api(path, options) {
      const init = { credentials: 'same-origin', ...options }
      if (init.body !== undefined) init.headers = { 'content-type': 'application/json' }
      const res = await fetch(`${BASE}${path}`, init)
      let data
      try {
        data = await res.json()
      } catch {
        data = undefined
      }
      if (!res.ok) {
        const error = new Error(data?.error ?? `${res.status} ${res.statusText}`)
        error.status = res.status
        error.data = data
        throw error
      }
      return data
    }

    function errorText(err) {
      if (err?.status === 401) return '登录状态已失效，请刷新页面重新登录。'
      return String(err?.message ?? err)
    }

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    function formatTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
      const date = new Date(ms)
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function formatClock(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
      const date = new Date(ms)
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    }

    function formatDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
      const total = Math.floor(ms / 1000)
      const days = Math.floor(total / 86400)
      const hours = Math.floor((total % 86400) / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      if (days > 0) return `${days} 天 ${hours} 小时`
      if (hours > 0) return `${hours} 小时 ${minutes} 分`
      if (minutes > 0) return `${minutes} 分 ${total % 60} 秒`
      return `${total} 秒`
    }

    function formatEta(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
      const diff = ms - Date.now()
      if (diff <= 0) return '已到时'
      return `${formatDuration(diff)}后`
    }

    function formatRelative(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
      const diff = ms - Date.now()
      if (diff >= 0) return `${formatTime(ms)}（${formatDuration(diff)}后）`
      return `${formatTime(ms)}（${formatDuration(-diff)}前）`
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—'
      if (bytes < 1024) return `${bytes} B`
      return `${(bytes / 1024).toFixed(1)} KB`
    }

    function wsMeta(state) {
      return WS_META[state] ?? { label: state ?? '未知', tone: 'idle', pulse: false }
    }

    function sessionStatusLabel(status) {
      return SESSION_STATUS[status] ?? status ?? '空闲'
    }

    function memoryTotals(memory) {
      if (memory === undefined || memory === null) return { entries: 0, chats: 0 }
      const chats = Array.isArray(memory.chats) ? memory.chats : []
      const entries = (memory.globalEntries ?? 0) + chats.reduce((sum, chat) => sum + (chat.entries ?? 0), 0)
      return { entries, chats: chats.length }
    }

    function Svg(props) {
      return h(
        'svg',
        {
          width: props.size ?? 16,
          height: props.size ?? 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: props.className,
          'aria-hidden': 'true',
          focusable: 'false',
        },
        props.children,
      )
    }

    function IconBot({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('rect', { x: 4.5, y: 6.5, width: 15, height: 11.5, rx: 3.5 }),
        h('path', { d: 'M12 3.6v3.1' }),
        h('circle', { cx: 12, cy: 2.5, r: 1.1 }),
        h('circle', { cx: 9, cy: 11.8, r: 1.05, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 15, cy: 11.8, r: 1.05, fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M9.4 15h5.2' }),
      )
    }

    function IconRefresh({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('path', { d: 'M20 11.5a8 8 0 1 0-2.35 5.65' }),
        h('path', { d: 'M20 5.5v6h-6' }),
      )
    }

    function IconChat({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('path', {
          d: 'M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-2.8-.45L4 20l1.45-4.55A7.3 7.3 0 0 1 4.5 11.5a7.5 7.5 0 0 1 8-7.5 7.5 7.5 0 0 1 7.5 7.5Z',
        }),
      )
    }

    function IconClock({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('circle', { cx: 12, cy: 12, r: 8 }),
        h('path', { d: 'M12 7.5V12l3 2' }),
      )
    }

    function IconSpark({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('path', { d: 'M12 3.5l1.7 4.6 4.8 1.7-4.8 1.7L12 16.1l-1.7-4.6L5.5 9.8l4.8-1.7L12 3.5Z' }),
        h('path', { d: 'M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z' }),
      )
    }

    function IconSliders({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('path', { d: 'M4 6h9' }),
        h('circle', { cx: 15, cy: 6, r: 2 }),
        h('path', { d: 'M17 6h3' }),
        h('path', { d: 'M4 12h3' }),
        h('circle', { cx: 9, cy: 12, r: 2 }),
        h('path', { d: 'M11 12h9' }),
        h('path', { d: 'M4 18h11' }),
        h('circle', { cx: 17, cy: 18, r: 2 }),
        h('path', { d: 'M19 18h1' }),
      )
    }

    function IconLink({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('path', { d: 'M10 14a4.5 4.5 0 0 0 6.4 0l2.4-2.4a4.5 4.5 0 0 0-6.4-6.4L11 6.6' }),
        h('path', { d: 'M14 10a4.5 4.5 0 0 0-6.4 0l-2.4 2.4a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4' }),
      )
    }

    function IconSend({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('path', { d: 'M20.5 3.5 10 14' }),
        h('path', { d: 'M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5Z' }),
      )
    }

    function IconUsers({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('circle', { cx: 9, cy: 8, r: 3.2 }),
        h('path', { d: 'M3.5 19.5a5.5 5.5 0 0 1 11 0' }),
        h('path', { d: 'M16 5.4a3.2 3.2 0 0 1 0 5.2' }),
        h('path', { d: 'M17.5 14.4a5.5 5.5 0 0 1 3 5.1' }),
      )
    }

    function IconAlert({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('path', { d: 'M12 4 21 19.5H3L12 4Z' }),
        h('path', { d: 'M12 9.5v4.2' }),
        h('circle', { cx: 12, cy: 16.8, r: 0.9, fill: 'currentColor', stroke: 'none' }),
      )
    }

    function IconCheck({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('circle', { cx: 12, cy: 12, r: 8 }),
        h('path', { d: 'm8.5 12 2.3 2.3 4.7-4.8' }),
      )
    }

    function IconInbox({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('path', { d: 'M4 13.5 6.2 5.5h11.6L20 13.5' }),
        h('path', { d: 'M4 13.5h4l1.2 2.5h5.6l1.2-2.5h4v3.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3.5Z' }),
      )
    }

    function IconGrid({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('rect', { x: 4, y: 4, width: 6.2, height: 6.2, rx: 1.5 }),
        h('rect', { x: 13.8, y: 4, width: 6.2, height: 6.2, rx: 1.5 }),
        h('rect', { x: 4, y: 13.8, width: 6.2, height: 6.2, rx: 1.5 }),
        h('rect', { x: 13.8, y: 13.8, width: 6.2, height: 6.2, rx: 1.5 }),
      )
    }

    function IconPower({ size, className }) {
      return h(
        Svg,
        { size, className },
        h('path', { d: 'M12 3.5v7' }),
        h('path', { d: 'M7.2 6.3a7 7 0 1 0 9.6 0' }),
      )
    }

    function useStyles() {
      React.useEffect(() => {
        if (typeof document === 'undefined') return
        if (document.getElementById(STYLE_ID) !== null) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
      }, [])
    }

    function useSnapshot() {
      const [snap, setSnap] = React.useState(undefined)
      const [error, setError] = React.useState('')
      const [refreshing, setRefreshing] = React.useState(false)
      const [updatedAt, setUpdatedAt] = React.useState(0)
      const alive = React.useRef(true)

      const load = React.useCallback(async (manual) => {
        if (manual) setRefreshing(true)
        try {
          const data = await api('/state')
          if (!alive.current) return
          setSnap(data)
          setError('')
          setUpdatedAt(Date.now())
        } catch (err) {
          if (alive.current) setError(errorText(err))
        } finally {
          if (alive.current && manual) setRefreshing(false)
        }
      }, [])

      React.useEffect(() => {
        alive.current = true
        void load(false)
        const timer = window.setInterval(() => {
          if (document.visibilityState !== 'hidden') void load(false)
        }, POLL_MS)
        return () => {
          alive.current = false
          window.clearInterval(timer)
        }
      }, [load])

      const refresh = React.useCallback(() => {
        void load(true)
      }, [load])

      return { snap, error, refreshing, updatedAt, refresh }
    }

    function FeishuPage() {
      useStyles()
      const { snap, error, refreshing, updatedAt, refresh } = useSnapshot()
      const [tab, setTab] = React.useState('overview')
      const [visited, setVisited] = React.useState({ overview: true })

      const sessions = Array.isArray(snap?.sessions) ? snap.sessions : []
      const tasks = Array.isArray(snap?.tasks) ? snap.tasks : []

      const selectTab = (id) => {
        setTab(id)
        setVisited((previous) => (previous[id] ? previous : { ...previous, [id]: true }))
      }

      const tabs = [
        { id: 'overview', label: '概览' },
        { id: 'sessions', label: '会话', count: sessions.length },
        { id: 'tasks', label: '定时任务', count: tasks.length },
        { id: 'memory', label: '记忆' },
        { id: 'tools', label: '工具挂载' },
        { id: 'settings', label: '设置' },
      ]

      const renderTab = (id) => {
        if (id === 'overview') return h(OverviewTab, { snap, refresh })
        if (id === 'sessions') return h(SessionsTab, { snap })
        if (id === 'tasks') return h(TasksTab, { snap, refresh })
        if (id === 'memory') return h(MemoryTab, { snap })
        if (id === 'tools') return h(ToolsTab)
        if (id === 'settings') return h(SettingsTab)
        return null
      }

      let body
      if (snap === undefined) {
        body =
          error !== ''
            ? h(EmptyState, {
                icon: IconAlert,
                title: '读取状态失败',
                message: error,
                action: h(
                  'button',
                  { type: 'button', className: 'fsp-btn primary', onClick: refresh },
                  '重试',
                ),
              })
            : h(
                'div',
                { className: 'fsp-loading' },
                h('div', { className: 'fsp-spinner' }),
                '正在读取飞书通道状态…',
              )
      } else {
        body = Object.keys(visited).map((id) =>
          h(
            'div',
            { key: id, className: 'fsp-tabpanel', hidden: id !== tab },
            renderTab(id),
          ),
        )
      }

      return h(
        'div',
        { className: 'fsp-root' },
        h(Header, { snap, error, refreshing, updatedAt, refresh }),
        snap !== undefined ? h(Tabs, { tabs, active: tab, onSelect: selectTab }) : null,
        h(
          'div',
          { className: 'fsp-body' },
          h(
            'div',
            { className: 'fsp-content' },
            snap !== undefined && error !== ''
              ? h(Alert, { tone: 'error', message: error })
              : null,
            body,
          ),
        ),
      )
    }

    function Header({ snap, error, refreshing, updatedAt, refresh }) {
      const [restartConfirming, setRestartConfirming] = React.useState(false)
      const [restartBusy, setRestartBusy] = React.useState(false)
      const [restartFailure, setRestartFailure] = React.useState('')
      const meta =
        snap === undefined
          ? { label: error !== '' ? '读取失败' : '读取中', tone: error !== '' ? 'error' : 'idle', pulse: false }
          : wsMeta(snap.ws?.state)

      React.useEffect(() => {
        if (!restartConfirming) return
        const timer = window.setTimeout(() => setRestartConfirming(false), 5000)
        return () => window.clearTimeout(timer)
      }, [restartConfirming])

      const restart = async () => {
        setRestartBusy(true)
        setRestartFailure('')
        try {
          await api('/action', {
            method: 'POST',
            body: JSON.stringify({ kind: 'restart' }),
          })
          setRestartConfirming(false)
          window.setTimeout(() => window.location.reload(), 18000)
        } catch (err) {
          setRestartFailure(errorText(err))
          setRestartBusy(false)
        }
      }

      return h(
        'header',
        { className: 'fsp-header' },
        h(
          'div',
          { className: 'fsp-brand' },
          h('span', { className: 'fsp-logo' }, h(IconBot, { size: 22 })),
          h(
            'div',
            { className: 'fsp-brand-text' },
            h('h1', { className: 'fsp-title' }, '飞书通道'),
            h('p', { className: 'fsp-subtitle' }, 'DeepSeek Harness · 长连接控制台'),
          ),
        ),
        h(
          'div',
          { className: 'fsp-header-right' },
          h(StatusPill, {
            label: meta.label,
            tone: meta.tone,
            pulse: meta.pulse,
            title: snap?.ws?.error ?? '',
          }),
          h('span', { className: 'fsp-updated' }, updatedAt > 0 ? `更新于 ${formatClock(updatedAt)}` : '尚未更新'),
          h(
            'button',
            {
              type: 'button',
              className: 'fsp-btn',
              onClick: refresh,
              disabled: refreshing,
              title: '刷新状态',
            },
            h(IconRefresh, { size: 14, className: refreshing ? 'fsp-spin' : undefined }),
            refreshing ? '刷新中…' : '刷新',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'fsp-btn danger-solid',
              disabled: restartBusy,
              onClick: restartConfirming ? () => void restart() : () => setRestartConfirming(true),
              title: restartBusy
                ? '正在重启，服务恢复后本页会自动刷新'
                : restartConfirming
                  ? '再点一次确认重启'
                  : '重启 dsh 服务：会中断正在进行的回合，重启后今天已有的会话按当前工具挂载重建',
            },
            restartBusy ? h('span', { className: 'fsp-spinner fsp-spinner-sm' }) : h(IconPower, { size: 14 }),
            restartBusy ? '重启中…' : restartConfirming ? '确认重启' : '重启',
          ),
          restartFailure !== ''
            ? h('span', { className: 'fsp-header-error', title: restartFailure }, restartFailure)
            : null,
        ),
      )
    }

    function Tabs({ tabs, active, onSelect }) {
      return h(
        'nav',
        { className: 'fsp-tabs', role: 'tablist', 'aria-label': '飞书面板页签' },
        tabs.map((item) =>
          h(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'tab',
              className: 'fsp-tab',
              'data-active': item.id === active ? 'true' : undefined,
              'aria-selected': item.id === active,
              onClick: () => onSelect(item.id),
            },
            item.label,
            typeof item.count === 'number' && item.count > 0
              ? h('span', { className: 'fsp-tab-count' }, String(item.count))
              : null,
          ),
        ),
      )
    }

    function StatusPill({ label, tone, pulse, title }) {
      return h(
        'span',
        { className: `fsp-status fsp-tone-${tone}`, title: title || undefined },
        h('span', { className: `fsp-dot${pulse ? ' fsp-pulse' : ''}` }),
        label,
      )
    }

    function StatusChip({ label, tone, pulse, title }) {
      return h(
        'span',
        { className: `fsp-chip fsp-tone-${tone}`, title: title || undefined },
        h('span', { className: `fsp-dot${pulse ? ' fsp-pulse' : ''}` }),
        label,
      )
    }

    function Alert({ tone, message, children }) {
      return h(
        'div',
        { className: `fsp-alert ${tone}`, role: tone === 'error' ? 'alert' : 'status' },
        h(tone === 'warn' || tone === 'error' ? IconAlert : IconCheck, { size: 14 }),
        h('div', null, message ?? children),
      )
    }

    function Card({ title, icon, extra, wide, className, children }) {
      return h(
        'section',
        { className: `fsp-card${wide ? ' wide' : ''}${className ? ` ${className}` : ''}` },
        title !== undefined
          ? h(
              'div',
              { className: 'fsp-card-head' },
              h(
                'div',
                { className: 'fsp-card-title' },
                icon !== undefined ? h(icon, { size: 15 }) : null,
                title,
              ),
              extra ?? null,
            )
          : null,
        children,
      )
    }

    function KvList({ rows }) {
      const children = []
      for (const row of rows) {
        children.push(
          h('dt', { key: `${row[0]}:label` }, row[0]),
          h('dd', { key: `${row[0]}:value` }, row[1]),
        )
      }
      return h('dl', { className: 'fsp-kv' }, children)
    }

    function EmptyState({ icon, title, message, action }) {
      const Icon = icon
      return h(
        'div',
        { className: 'fsp-empty' },
        h('span', { className: 'fsp-empty-glyph' }, h(Icon, { size: 22 })),
        h('h3', null, title),
        message !== undefined ? h('p', null, message) : null,
        action ?? null,
      )
    }

    function OverviewTab({ snap, refresh }) {
      const ws = snap.ws ?? {}
      const config = snap.config ?? {}
      const sessions = Array.isArray(snap.sessions) ? snap.sessions : []
      const tasks = Array.isArray(snap.tasks) ? snap.tasks : []
      const meta = wsMeta(ws.state)
      const totals = memoryTotals(snap.memory)
      const queue = sessions.reduce((sum, session) => sum + (Number(session.queue) || 0), 0)
      const pending = sessions.reduce((sum, session) => sum + (Number(session.pending) || 0), 0)
      const nextTask = tasks
        .filter((task) => typeof task.nextAt === 'number' && Number.isFinite(task.nextAt))
        .sort((left, right) => left.nextAt - right.nextAt)[0]
      const memory = snap.memory
      const chatCount = Array.isArray(memory?.chats) ? memory.chats.length : 0

      return h(
        'div',
        { className: 'fsp-stack' },
        h(
          'div',
          { className: 'fsp-stats' },
          h(StatCard, {
            label: '长连接',
            value: meta.label,
            tone: meta.tone,
            icon: IconLink,
            dot: true,
            note: ws.since > 0 ? `自 ${formatClock(ws.since)} 起` : ws.error || '尚未建立连接',
          }),
          h(StatCard, {
            label: '活跃会话',
            value: String(sessions.length),
            icon: IconChat,
            note: sessions.length > 0 ? `队列 ${queue} · 待领 ${pending}` : '当前进程内还没有会话',
          }),
          h(StatCard, {
            label: '定时任务',
            value: String(tasks.length),
            icon: IconClock,
            note: nextTask !== undefined ? `最近一条 ${formatEta(nextTask.nextAt)}` : '没有待触发的任务',
          }),
          h(StatCard, {
            label: '记忆条目',
            value: String(totals.entries),
            icon: IconSpark,
            note:
              memory !== undefined && memory !== null
                ? `全局 ${memory.globalEntries ?? 0} 条 · ${chatCount} 个 chat`
                : '记忆目录不可读',
          }),
        ),
        h(
          'div',
          { className: 'fsp-grid' },
          h(
            Card,
            { title: '运行参数', icon: IconSliders },
            h(KvList, {
              rows: [
                ['Preset', `主人 ${config.ownerPreset ?? '—'} · 其他 ${config.agentPreset ?? '—'}`],
                [
                  '回复超时',
                  `普通 ${formatDuration(config.replyTimeoutMs)} · 主人 ${formatDuration(config.ownerReplyTimeoutMs)}`,
                ],
                ['单轮上限', formatDuration(config.maxTurnMs)],
                [
                  '回复方式',
                  h(
                    'span',
                    { className: 'fsp-inline-chips' },
                    h('span', { className: 'fsp-chip' }, config.cardStreaming ? '流式卡片' : '普通消息'),
                    h('span', { className: 'fsp-chip' }, config.syncWebToFeishu ? '网页镜像 开' : '网页镜像 关'),
                  ),
                ],
                ['群聊触发', config.requireMentionInGroup ? '仅 @ 机器人' : '全部消息'],
                [
                  '时区 / 前缀',
                  h(
                    'span',
                    { className: 'fsp-mono' },
                    `${config.timeZone ?? '—'} · ${config.sessionPrefix ?? '—'}`,
                  ),
                ],
              ],
            }),
          ),
          h(AccessCard, { snap }),
          h(CuratorCard, { curator: snap.curator, refresh }),
          h(RuntimeCard, { snap }),
        ),
        h(ActionsCard),
      )
    }

    function StatCard({ label, value, tone, icon, note, dot }) {
      const Icon = icon
      return h(
        'div',
        { className: 'fsp-stat' },
        h(
          'div',
          { className: 'fsp-stat-top' },
          h('span', { className: 'fsp-stat-label' }, label),
          Icon !== undefined ? h('span', { className: 'fsp-stat-icon' }, h(Icon, { size: 16 })) : null,
        ),
        h(
          'div',
          { className: `fsp-stat-value${tone ? ` fsp-tone-${tone}` : ''}`, title: String(value) },
          dot ? h('span', { className: `fsp-dot${tone === 'success' || tone === 'warn' ? ' fsp-pulse' : ''}` }) : null,
          value,
        ),
        h('div', { className: 'fsp-stat-note', title: note }, note),
      )
    }

    function AccessCard({ snap }) {
      const access = snap.access ?? {}
      const config = snap.config ?? {}
      const groups = Array.isArray(access.allowedChatIds) ? access.allowedChatIds : []
      const users = Array.isArray(access.allowedOpenIds) ? access.allowedOpenIds : []

      return h(
        Card,
        { title: '访问控制', icon: IconUsers },
        h(KvList, {
          rows: [
            [
              '主人私聊',
              config.ownerChatId
                ? h('span', { className: 'fsp-mono' }, config.ownerChatId)
                : h('span', { className: 'fsp-muted' }, '未配置'),
            ],
            [
              '白名单',
              h(
                'span',
                { className: `fsp-chip fsp-tone-${access.discovery ? 'warn' : 'success'}` },
                access.discovery ? '发现模式' : '已启用',
              ),
            ],
          ],
        }),
        access.discovery
          ? h(Alert, {
              tone: 'warn',
              message:
                '白名单为空时处于发现模式：所有消息都会被忽略，日志会打印 chat_id / sender id。把它们填进白名单即可放行。',
            })
          : null,
        h(
          'div',
          { className: 'fsp-subgroup' },
          h(
            'div',
            { className: 'fsp-subtitle-row' },
            h('span', null, '群聊'),
            h('span', { className: 'fsp-count-pill' }, String(groups.length)),
          ),
          h(IdChips, { ids: groups, empty: '未配置群聊白名单' }),
        ),
        h(
          'div',
          { className: 'fsp-subgroup' },
          h(
            'div',
            { className: 'fsp-subtitle-row' },
            h('span', null, '私聊'),
            h('span', { className: 'fsp-count-pill' }, String(users.length)),
          ),
          h(IdChips, { ids: users, empty: '未配置私聊白名单' }),
        ),
      )
    }

    function IdChips({ ids, empty }) {
      if (ids.length === 0) return h('div', { className: 'fsp-hint' }, empty)
      return h(
        'div',
        { className: 'fsp-ids' },
        ids.map((id) => h('code', { key: id, className: 'fsp-id-chip', title: id }, id)),
      )
    }

    function CuratorCard({ curator, refresh }) {
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [failure, setFailure] = React.useState('')

      if (curator === undefined || curator === null) {
        return h(
          Card,
          { title: '记忆整理', icon: IconSpark },
          h('div', { className: 'fsp-hint' }, '整理器没有注册运行时（可能未启用）。'),
        )
      }

      const run = async () => {
        setBusy(true)
        setMessage('')
        setFailure('')
        try {
          const result = await api('/action', {
            method: 'POST',
            body: JSON.stringify({ kind: 'curator-run' }),
          })
          if (result?.accepted) setMessage('已开始整理，完成后状态会自动刷新。')
          else setFailure('整理器正在运行，本次手动触发被忽略。')
          await refresh()
        } catch (err) {
          setFailure(errorText(err))
        } finally {
          setBusy(false)
        }
      }

      const running = busy || curator.running === true

      return h(
        Card,
        {
          title: '记忆整理',
          icon: IconSpark,
          extra: h(
            'div',
            { className: 'fsp-inline-chips' },
            h(StatusChip, {
              label: curator.running ? '整理中' : '空闲',
              tone: curator.running ? 'accent' : 'idle',
              pulse: curator.running === true,
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'fsp-btn sm',
                disabled: running,
                onClick: () => void run(),
              },
              running ? '整理中…' : '立即整理',
            ),
          ),
        },
        h(KvList, {
          rows: [
            ['下次运行', formatRelative(curator.nextRunAt)],
            ['上次结束', formatRelative(curator.lastFinishedAt)],
            ['上次触发', curator.lastTrigger ?? '—'],
            [
              '上次结果',
              curator.lastRunAt === undefined
                ? '还没有成功记录'
                : `${formatTime(curator.lastRunAt)} · ${curator.lastSessions ?? 0} 个会话 / ${curator.lastChars ?? 0} 字符`,
            ],
            ['计划', `${curator.curatorTime ?? '—'} · ${curator.timeZone ?? '—'}`],
          ],
        }),
        curator.lastError
          ? h(Alert, { tone: 'error', message: `上次错误：${curator.lastError}` })
          : null,
        message !== ''
          ? h('div', { className: 'fsp-inline-msg fsp-tone-success' }, h(IconCheck, { size: 13 }), message)
          : null,
        failure !== ''
          ? h('div', { className: 'fsp-inline-msg fsp-tone-error' }, h(IconAlert, { size: 13 }), failure)
          : null,
      )
    }

    function RuntimeCard({ snap }) {
      const ws = snap.ws ?? {}
      const plugin = snap.plugin ?? {}
      const meta = wsMeta(ws.state)

      return h(
        Card,
        { title: '运行信息', icon: IconLink },
        h(KvList, {
          rows: [
            [
              'Worker',
              h('span', { className: 'fsp-inline-chips' },
                h('span', { className: 'fsp-mono' }, plugin.version ?? '—'),
                h('span', { className: 'fsp-hint' }, plugin.name ?? 'feishu-channel'),
              ),
            ],
            ['运行时长', formatDuration(plugin.uptimeMs)],
            [
              '长连接',
              `${meta.label}${ws.since > 0 ? ` · 自 ${formatClock(ws.since)}` : ''}`,
            ],
          ],
        }),
        ws.error ? h(Alert, { tone: 'error', message: `连接错误：${ws.error}` }) : null,
        h('div', { className: 'fsp-hint' }, '状态每 15 秒自动刷新；参数保存后立即生效。'),
      )
    }

    function ActionsCard() {
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [failure, setFailure] = React.useState('')

      const send = async () => {
        setBusy(true)
        setMessage('')
        setFailure('')
        try {
          const result = await api('/action', {
            method: 'POST',
            body: JSON.stringify({ kind: 'send-test', text }),
          })
          setMessage(`已经发到主人私聊${result?.chatId ? `（${result.chatId}）` : ''}。`)
          setText('')
        } catch (err) {
          setFailure(errorText(err))
        } finally {
          setBusy(false)
        }
      }

      return h(
        Card,
        { title: '快捷操作', icon: IconSend, wide: true },
        h(
          'p',
          { className: 'fsp-card-desc' },
          '向主人私聊发送一条测试消息，用来验证长连接和发送链路。留空会使用默认文案。',
        ),
        h(
          'div',
          { className: 'fsp-action-row' },
          h('input', {
            type: 'text',
            className: 'fsp-input',
            placeholder: '测试消息内容（可留空）',
            value: text,
            'aria-label': '测试消息内容',
            onChange: (event) => setText(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !busy) {
                event.preventDefault()
                void send()
              }
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'fsp-btn primary',
              disabled: busy,
              onClick: () => void send(),
            },
            busy ? h('span', { className: 'fsp-spinner fsp-spinner-sm' }) : h(IconSend, { size: 14 }),
            busy ? '发送中…' : '发送消息',
          ),
        ),
        message !== ''
          ? h('div', { className: 'fsp-inline-msg fsp-tone-success' }, h(IconCheck, { size: 13 }), message)
          : null,
        failure !== ''
          ? h('div', { className: 'fsp-inline-msg fsp-tone-error' }, h(IconAlert, { size: 13 }), failure)
          : null,
      )
    }

    function SessionsTab({ snap }) {
      const sessions = Array.isArray(snap.sessions) ? snap.sessions : []
      return h(
        'div',
        { className: 'fsp-stack' },
        h(
          'div',
          { className: 'fsp-section-head' },
          h(
            'div',
            null,
            h('h2', { className: 'fsp-h2' }, '活跃会话'),
            h(
              'p',
              { className: 'fsp-desc' },
              '当前进程里正在使用的飞书会话；进程重启后这里会清空，历史仍可在左侧会话列表里找到。',
            ),
          ),
          h('span', { className: 'fsp-count-pill' }, `${sessions.length} 个`),
        ),
        sessions.length === 0
          ? h(EmptyState, {
              icon: IconChat,
              title: '还没有活跃会话',
              message: '收到第一条飞书消息时，这里会出现对应的会话。',
            })
          : h(
              'div',
              { className: 'fsp-sessions' },
              sessions.map((session) => h(SessionCard, { key: session.sessionId, session })),
            ),
      )
    }

    function SessionCard({ session }) {
      const kind = session.owner
        ? { label: '主人私聊', glyph: '主', cls: 'owner' }
        : session.chatType === 'group'
          ? { label: '群聊', glyph: '群', cls: 'group' }
          : { label: '私聊', glyph: '私', cls: 'dm' }
      const tone = session.retired ? 'idle' : session.driving ? 'success' : session.status === 'error' ? 'error' : 'idle'
      const status = session.retired ? '退役中' : session.driving ? '运行中' : sessionStatusLabel(session.status)
      const deadline =
        typeof session.deadline === 'number' && session.deadline > 0 ? formatEta(session.deadline) : '—'
      const deadlineTitle =
        typeof session.deadline === 'number' && session.deadline > 0 ? formatTime(session.deadline) : ''

      return h(
        'article',
        { className: 'fsp-session' },
        h(
          'div',
          { className: 'fsp-session-head' },
          h('span', { className: `fsp-avatar ${kind.cls}` }, kind.glyph),
          h(
            'div',
            { className: 'fsp-session-main' },
            h(
              'div',
              { className: 'fsp-session-title' },
              h('span', { className: 'fsp-session-kind' }, kind.label),
              h(StatusChip, { label: status, tone, pulse: session.driving === true, title: session.status }),
            ),
            h(
              'div',
              { className: 'fsp-ellipsis fsp-mono fsp-muted', title: session.chatId },
              session.chatId,
            ),
          ),
        ),
        h(
          'div',
          { className: 'fsp-session-id fsp-mono fsp-ellipsis', title: session.sessionId },
          session.sessionId,
        ),
        h(
          'div',
          { className: 'fsp-session-meta' },
          h('span', null, '队列 ', h('b', null, String(session.queue ?? 0))),
          h('span', null, '待领 ', h('b', null, String(session.pending ?? 0))),
          h('span', { title: deadlineTitle }, '截止 ', deadline),
        ),
      )
    }

    function TasksTab({ snap, refresh }) {
      const tasks = Array.isArray(snap.tasks) ? snap.tasks : []
      const [busy, setBusy] = React.useState('')
      const [confirm, setConfirm] = React.useState('')
      const [failure, setFailure] = React.useState('')

      React.useEffect(() => {
        if (confirm === '') return
        const timer = window.setTimeout(() => setConfirm(''), 4000)
        return () => window.clearTimeout(timer)
      }, [confirm])

      const cancel = async (task) => {
        setBusy(task.id)
        setFailure('')
        try {
          await api('/action', {
            method: 'POST',
            body: JSON.stringify({ kind: 'cancel-task', id: task.id }),
          })
          setConfirm('')
          await refresh()
        } catch (err) {
          setFailure(errorText(err))
        } finally {
          setBusy('')
        }
      }

      return h(
        'div',
        { className: 'fsp-stack' },
        h(
          'div',
          { className: 'fsp-section-head' },
          h(
            'div',
            null,
            h('h2', { className: 'fsp-h2' }, '定时任务'),
            h('p', { className: 'fsp-desc' }, '由机器人创建、等待触发的任务。取消是两步确认，避免误点。'),
          ),
          h('span', { className: 'fsp-count-pill' }, `${tasks.length} 个`),
        ),
        failure !== '' ? h(Alert, { tone: 'error', message: failure }) : null,
        tasks.length === 0
          ? h(EmptyState, {
              icon: IconClock,
              title: '没有待触发的任务',
              message: '让机器人设一个提醒，或从会话里创建定时任务后，这里会显示。',
            })
          : h(
              'div',
              { className: 'fsp-tasks' },
              tasks.map((task) =>
                h(TaskCard, {
                  key: task.id,
                  task,
                  busy: busy === task.id,
                  confirming: confirm === task.id,
                  onAsk: () => setConfirm(task.id),
                  onCancel: () => void cancel(task),
                }),
              ),
            ),
      )
    }

    function TaskCard({ task, busy, confirming, onAsk, onCancel }) {
      const next =
        typeof task.nextAt === 'number' && Number.isFinite(task.nextAt)
          ? formatEta(task.nextAt)
          : task.nextAtText ?? '—'
      const nextTitle = formatTime(task.nextAt)

      return h(
        'article',
        { className: 'fsp-task' },
        h(
          'div',
          { className: 'fsp-task-head' },
          h(
            'div',
            { className: 'fsp-task-when' },
            h(IconClock, { size: 15 }),
            h('span', { className: 'fsp-task-next', title: nextTitle }, next),
            h('span', { className: 'fsp-mono fsp-ellipsis', title: task.chatId }, task.chatId),
          ),
          h(
            'button',
            {
              type: 'button',
              className: `fsp-btn sm ${confirming ? 'danger' : ''}`,
              disabled: busy,
              onClick: confirming ? onCancel : onAsk,
              title: confirming ? '再点一次确认取消这个任务' : '取消任务',
            },
            busy ? '取消中…' : confirming ? '确认取消' : '取消',
          ),
        ),
        h('pre', { className: 'fsp-task-prompt' }, task.prompt),
        h(
          'div',
          { className: 'fsp-task-foot' },
          h('span', { className: 'fsp-chip' }, `重复 ${task.repeatText ?? '—'}`),
          task.nextAtText ? h('span', { className: 'fsp-hint' }, `下次 ${task.nextAtText}`) : null,
        ),
      )
    }

    function MemoryTab({ snap }) {
      const memory = snap.memory
      const [scope, setScope] = React.useState('global')
      const [detail, setDetail] = React.useState(undefined)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const requestRef = React.useRef(0)
      const available = memory !== undefined && memory !== null
      const chats = Array.isArray(memory?.chats) ? memory.chats : []

      const load = React.useCallback(async (target) => {
        const seq = ++requestRef.current
        setBusy(true)
        try {
          const data = await api(`/memory?chat=${encodeURIComponent(target)}`)
          if (seq !== requestRef.current) return
          setDetail(data)
          setError('')
        } catch (err) {
          if (seq !== requestRef.current) return
          setError(errorText(err))
        } finally {
          if (seq === requestRef.current) setBusy(false)
        }
      }, [])

      React.useEffect(() => {
        if (available) void load(scope)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [available])

      React.useEffect(() => {
        if (scope !== 'global' && !chats.some((chat) => chat.chatId === scope)) {
          setScope('global')
          setDetail(undefined)
          if (available) void load('global')
        }
      }, [chats, scope, available, load])

      if (!available) {
        return h(EmptyState, {
          icon: IconInbox,
          title: '记忆不可用',
          message: '记忆目录不可读，或者这个 profile 没有配置记忆作用域。',
        })
      }

      const totals = memoryTotals(memory)
      const grouped = new Map()
      for (const entry of detail?.entries ?? []) {
        const key = entry.section ?? '其他'
        const list = grouped.get(key) ?? []
        list.push(entry)
        grouped.set(key, list)
      }

      const groups = []
      grouped.forEach((entries, section) => {
        const rows = entries.map((entry, index) =>
          h(
            'div',
            { className: 'fsp-entry', key: `${section}-${index}` },
            h('span', { className: 'fsp-entry-date' }, entry.date ?? ''),
            h('span', { className: 'fsp-entry-text' }, entry.text),
          ),
        )
        groups.push(
          h(
            'section',
            { className: 'fsp-memory-group', key: section },
            h(
              'div',
              { className: 'fsp-memory-group-title' },
              h('span', null, section),
              h('span', { className: 'fsp-count-pill' }, String(entries.length)),
            ),
            rows,
          ),
        )
      })

      const scopeLabel = scope === 'global' ? '全局记忆' : scope
      const scopeMeta =
        scope === 'global'
          ? `${memory.globalEntries ?? 0} 条`
          : (() => {
              const chat = chats.find((item) => item.chatId === scope)
              return chat === undefined ? '' : `${chat.entries} 条 · ${formatBytes(chat.bytes)}`
            })()

      return h(
        'div',
        { className: 'fsp-stack' },
        h(
          'div',
          { className: 'fsp-section-head' },
          h(
            'div',
            null,
            h('h2', { className: 'fsp-h2' }, '记忆'),
            h(
              'p',
              { className: 'fsp-desc' },
              '全局记忆只由主人私聊和整理会话写入；每个 chat 有各自的记忆文件。这里只读展示，写入仍走对话里的记忆工具。',
            ),
          ),
          h('span', { className: 'fsp-count-pill' }, `${totals.entries} 条 · ${totals.chats} 个 chat`),
        ),
        h(
          'div',
          { className: 'fsp-memory' },
          h(
            'aside',
            { className: 'fsp-scopes' },
            h('div', { className: 'fsp-scope-head' }, '作用域'),
            h(ScopeButton, {
              active: scope === 'global',
              name: '全局记忆',
              meta: `${memory.globalEntries ?? 0} 条`,
              onClick: () => {
                if (scope === 'global') return
                setScope('global')
                setDetail(undefined)
                void load('global')
              },
            }),
            chats.map((chat) =>
              h(ScopeButton, {
                key: chat.chatId,
                active: scope === chat.chatId,
                name: chat.chatId,
                mono: true,
                meta: `${chat.entries} 条 · ${formatBytes(chat.bytes)}`,
                onClick: () => {
                  if (scope === chat.chatId) return
                  setScope(chat.chatId)
                  setDetail(undefined)
                  void load(chat.chatId)
                },
              }),
            ),
          ),
          h(
            'section',
            { className: 'fsp-card fsp-memory-detail' },
            h(
              'div',
              { className: 'fsp-card-head' },
              h(
                'div',
                { className: 'fsp-card-title' },
                h(IconSpark, { size: 15 }),
                h('span', { className: scope === 'global' ? undefined : 'fsp-mono' }, scopeLabel),
                h('span', { className: 'fsp-count-pill' }, scopeMeta),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'fsp-btn sm',
                  disabled: busy,
                  onClick: () => void load(scope),
                },
                h(IconRefresh, { size: 13, className: busy ? 'fsp-spin' : undefined }),
                busy ? '读取中…' : '刷新',
              ),
            ),
            error !== '' ? h(Alert, { tone: 'error', message: error }) : null,
            detail === undefined
              ? h('div', { className: 'fsp-loading', style: { minHeight: 200 } }, h('div', { className: 'fsp-spinner' }), '读取记忆条目…')
              : (detail.entries ?? []).length === 0
                ? h('div', { className: 'fsp-hint' }, '这个作用域还没有记忆条目。')
                : h('div', { className: 'fsp-memory-groups' }, groups),
            detail?.render
              ? h(
                  'details',
                  { className: 'fsp-details' },
                  h('summary', null, '提示词注入预览（截断后的实际内容）'),
                  h('pre', null, detail.render),
                )
              : null,
            h('div', { className: 'fsp-hint fsp-mono' }, memory.dir ?? ''),
          ),
        ),
      )
    }

    function ScopeButton({ active, name, meta, mono, onClick }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'fsp-scope',
          'data-active': active ? 'true' : undefined,
          onClick,
          title: name,
        },
        h('span', { className: `fsp-scope-name${mono ? ' fsp-mono' : ''}` }, name),
        meta !== '' ? h('span', { className: 'fsp-scope-meta' }, meta) : null,
      )
    }

    function ToolsTab() {
      const [data, setData] = React.useState(undefined)
      const [error, setError] = React.useState('')
      const [busyKey, setBusyKey] = React.useState('')
      const [notice, setNotice] = React.useState(undefined)

      const load = React.useCallback(async () => {
        try {
          const result = await api('/tools')
          setData(result)
          setError('')
        } catch (err) {
          setError(errorText(err))
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      if (data === undefined && error !== '') {
        return h(EmptyState, {
          icon: IconAlert,
          title: '读取工具挂载失败',
          message: error,
          action: h('button', { type: 'button', className: 'fsp-btn primary', onClick: () => void load() }, '重试'),
        })
      }
      if (data === undefined) {
        return h(
          'div',
          { className: 'fsp-loading' },
          h('div', { className: 'fsp-spinner' }),
          '正在读取 preset 工具挂载…',
        )
      }

      const presets = Array.isArray(data.presets) ? data.presets : []

      const toggle = async (preset, row, disabled) => {
        const key = `${preset.id}:${row.path.join('.')}`
        setBusyKey(key)
        setNotice(undefined)
        try {
          const result = await api('/tools', {
            method: 'POST',
            body: JSON.stringify({ preset: preset.id, path: row.path, disabled }),
          })
          if (result?.preset) {
            setData((previous) => ({
              ...previous,
              presets: (previous?.presets ?? []).map((item) => (item.id === preset.id ? result.preset : item)),
            }))
          }
          setNotice({
            tone: 'success',
            text: `${preset.name} 已保存；新建的会话会使用这组工具。`,
          })
        } catch (err) {
          setNotice({ tone: 'error', text: errorText(err) })
          await load()
        } finally {
          setBusyKey('')
        }
      }

      return h(
        'div',
        { className: 'fsp-stack' },
        h(
          'div',
          { className: 'fsp-section-head' },
          h(
            'div',
            null,
            h('h2', { className: 'fsp-h2' }, '工具挂载'),
            h(
              'p',
              { className: 'fsp-desc' },
              '这里只列出飞书插件自己声明的 preset，每行对应一个工具插件。关掉某一行，它就不会挂载给新建会话；改动写回 profile 的 cordis.patch.yml 并热重载该 preset，不用重启服务。',
            ),
          ),
          h('span', { className: 'fsp-count-pill' }, `${presets.length} 个 preset`),
        ),
        notice !== undefined
          ? h(Alert, { tone: notice.tone === 'success' ? 'info' : notice.tone, message: notice.text })
          : null,
        error !== '' ? h(Alert, { tone: 'error', message: error }) : null,
        h(Alert, {
          tone: 'info',
          message:
            '正在进行的会话会保留旧工具集直到结束（飞书会话按天新建，明天起自动用新挂载）。标「条件」的行原本由表达式决定启停，手动切换后会变成固定开关。',
        }),
        presets.length === 0
          ? h(EmptyState, {
              icon: IconGrid,
              title: '没有可编辑的 preset',
              message: '当前 profile 里没有活动的 preset-feishu* 条目，检查本插件的 cordis.patch.yml 是否已加载。',
            })
          : h(
              'div',
              { className: 'fsp-tools' },
              presets.map((preset) =>
                h(PresetCard, {
                  key: preset.id,
                  preset,
                  busyKey,
                  onToggle: (row, disabled) => void toggle(preset, row, disabled),
                }),
              ),
            ),
      )
    }

    function PresetCard({ preset, busyKey, onToggle }) {
      return h(
        'section',
        { className: 'fsp-card' },
        h(
          'div',
          { className: 'fsp-card-head' },
          h(
            'div',
            { className: 'fsp-card-title' },
            h(IconGrid, { size: 15 }),
            preset.name,
            h('code', { className: 'fsp-field-code' }, preset.id),
          ),
          h(
            'div',
            { className: 'fsp-inline-chips' },
            preset.active === false
              ? h(StatusChip, { label: '未激活', tone: 'warn' })
              : h(StatusChip, { label: '已挂载', tone: 'success' }),
            preset.order !== null && preset.order !== undefined
              ? h('span', { className: 'fsp-hint' }, `order ${preset.order}`)
              : null,
          ),
        ),
        preset.description ? h('p', { className: 'fsp-card-desc' }, preset.description) : null,
        preset.broken !== undefined ? h(Alert, { tone: 'error', message: `挂载诊断：${preset.broken}` }) : null,
        h(
          'div',
          { className: 'fsp-tool-rows' },
          (preset.rows ?? []).map((row) =>
            h(ToolRow, {
              key: row.path.join('.'),
              preset,
              row,
              parentOff: false,
              busyKey,
              onToggle,
            }),
          ),
        ),
      )
    }

    function ToolRow({ preset, row, parentOff, busyKey, onToggle }) {
      const meta = TOOL_META[row.name] ?? {}
      const label = row.group
        ? GROUP_META[row.id]?.label ?? meta.label ?? row.id ?? '分组'
        : meta.label ?? row.id ?? row.name
      const pending = busyKey === `${preset.id}:${row.path.join('.')}`
      const off = row.disabled === true
      const dim = parentOff && !off
      const hasCondition = typeof row.condition === 'string'

      const head = h(
        'div',
        { className: `fsp-tool-row${off ? ' off' : ''}${dim ? ' dim' : ''}`, title: meta.desc ?? row.name },
        h(
          'label',
          { className: 'fsp-switch fsp-tool-switch', title: off ? '点击启用' : '点击禁用' },
          h('input', {
            type: 'checkbox',
            checked: !off,
            disabled: pending,
            'aria-label': `${label} 工具开关`,
            onChange: (event) => onToggle(row, !event.target.checked),
          }),
          h('span', { className: 'fsp-switch-track' }),
        ),
        h(
          'div',
          { className: 'fsp-tool-main' },
          h(
            'div',
            { className: 'fsp-tool-title' },
            h('span', { className: 'fsp-tool-name' }, label),
            pending ? h('span', { className: 'fsp-spinner fsp-spinner-sm' }) : null,
            row.group ? h('span', { className: 'fsp-chip' }, '分组') : null,
            hasCondition ? h('span', { className: 'fsp-chip fsp-tone-warn', title: row.condition }, '条件') : null,
            off ? h('span', { className: 'fsp-chip fsp-tone-idle' }, '已禁用') : null,
            dim ? h('span', { className: 'fsp-tool-cond' }, '所属分组已禁用') : null,
          ),
          h(
            'div',
            { className: 'fsp-tool-meta' },
            row.id !== null ? h('code', { className: 'fsp-field-code' }, row.id) : null,
            h('span', { className: 'fsp-tool-mod fsp-mono' }, row.name),
            hasCondition ? h('code', { className: 'fsp-tool-cond fsp-mono' }, row.condition) : null,
          ),
        ),
      )

      if (row.group !== true || !Array.isArray(row.children)) return head
      return h(
        React.Fragment,
        { key: row.path.join('.') },
        head,
        h(
          'div',
          { className: 'fsp-tool-children' },
          row.children.map((child) =>
            h(ToolRow, {
              key: child.path.join('.'),
              preset,
              row: child,
              parentOff: parentOff || off,
              busyKey,
              onToggle,
            }),
          ),
        ),
      )
    }

    function SettingsTab() {
      const [params, setParams] = React.useState(undefined)
      const [drafts, setDrafts] = React.useState({})
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)

      const applyData = React.useCallback((data) => {
        setParams(data)
        const next = {}
        for (const field of data.fields ?? []) next[field.name] = valueToDraft(field)
        setDrafts(next)
      }, [])

      const load = React.useCallback(async () => {
        try {
          const data = await api('/params')
          applyData(data)
          setError('')
        } catch (err) {
          setError(errorText(err))
        }
      }, [applyData])

      React.useEffect(() => {
        void load()
      }, [load])

      if (error !== '' && params === undefined) {
        return h(EmptyState, {
          icon: IconAlert,
          title: '读取参数失败',
          message: error,
          action: h('button', { type: 'button', className: 'fsp-btn primary', onClick: () => void load() }, '重试'),
        })
      }
      if (params === undefined) {
        return h(
          'div',
          { className: 'fsp-loading' },
          h('div', { className: 'fsp-spinner' }),
          '正在读取可热更新参数…',
        )
      }

      const fields = params.fields ?? []
      const dirty = fields.filter(
        (field) => JSON.stringify(drafts[field.name]) !== JSON.stringify(valueToDraft(field)),
      )

      const setDraft = (name, value) => setDrafts((previous) => ({ ...previous, [name]: value }))

      const save = async () => {
        setBusy(true)
        setNotice(undefined)
        try {
          const patch = {}
          for (const field of fields) {
            const draft = drafts[field.name]
            if (JSON.stringify(draft) === JSON.stringify(valueToDraft(field))) continue
            const converted = draftToValue(field, draft)
            if (!converted.ok) throw new Error(converted.error)
            patch[field.name] = converted.value
          }
          if (Object.keys(patch).length === 0) {
            setNotice({ tone: 'info', text: '没有需要保存的改动。' })
            return
          }
          const data = await api('/params', {
            method: 'POST',
            body: JSON.stringify({ revision: params.revision, patch }),
          })
          applyData(data)
          setNotice({ tone: 'success', text: '已保存，改动立即生效。' })
        } catch (err) {
          if (err?.status === 409) {
            setNotice({ tone: 'error', text: '配置已被其他窗口修改，已重新读取最新值，请重新修改。' })
            await load()
          } else {
            setNotice({ tone: 'error', text: errorText(err) })
          }
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'fsp-stack' },
        h(
          'div',
          { className: 'fsp-section-head' },
          h(
            'div',
            null,
            h('h2', { className: 'fsp-h2' }, '热更新参数'),
            h(
              'p',
              { className: 'fsp-desc' },
              '这些字段写回 profile 的 cordis.patch.yml，保存后立即生效；密钥和结构性字段不在这里，仍然改配置后重启。',
            ),
          ),
          h('span', { className: 'fsp-count-pill' }, `revision ${params.revision ?? '—'}`),
        ),
        h(
          Card,
          { className: 'fsp-settings' },
          error !== '' ? h(Alert, { tone: 'error', message: error }) : null,
          notice !== undefined
            ? h(Alert, {
                tone: notice.tone === 'success' ? 'info' : notice.tone,
                message: notice.text,
              })
            : null,
          h(
            'div',
            { className: 'fsp-fields' },
            fields.map((field) =>
              h(FieldRow, {
                key: field.name,
                field,
                draft: drafts[field.name],
                onChange: (value) => setDraft(field.name, value),
              }),
            ),
          ),
          h(
            'div',
            { className: 'fsp-savebar' },
            h(
              'span',
              { className: 'fsp-save-note' },
              dirty.length > 0 ? `${dirty.length} 项待保存` : '所有改动已保存',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'fsp-btn primary',
                disabled: busy || dirty.length === 0,
                onClick: () => void save(),
              },
              busy ? h('span', { className: 'fsp-spinner fsp-spinner-sm' }) : null,
              busy ? '保存中…' : '保存改动',
            ),
          ),
        ),
      )
    }

    function FieldRow({ field, draft, onChange }) {
      const meta = FIELD_META[field.name] ?? {}
      const label = meta.label ?? field.name
      const help = meta.desc ?? field.description ?? ''
      const defaultText =
        field.default !== undefined && field.default !== null && !(Array.isArray(field.default) && field.default.length === 0)
          ? `默认：${JSON.stringify(field.default)}`
          : ''

      let control
      let hint = ''
      if (field.type === 'boolean') {
        control = h(
          'label',
          { className: 'fsp-switch' },
          h('input', {
            type: 'checkbox',
            checked: draft === true,
            'aria-label': label,
            onChange: (event) => onChange(event.target.checked),
          }),
          h('span', { className: 'fsp-switch-track' }),
          h('span', { className: 'fsp-switch-text' }, draft === true ? '开启' : '关闭'),
        )
      } else if (field.type === 'number') {
        const numeric = typeof draft === 'number' && Number.isFinite(draft)
        const isMs = /Ms$/.test(field.name)
        control = h('input', {
          type: 'number',
          className: 'fsp-input',
          step: 'any',
          value: draft === undefined || draft === null ? '' : String(draft),
          'aria-label': label,
          onChange: (event) => onChange(event.target.value === '' ? '' : Number(event.target.value)),
        })
        if (!numeric) hint = '请输入数字'
        else if (isMs) hint = `${draft} 毫秒 ≈ ${formatDuration(draft)}`
      } else if (field.type === 'array') {
        const lines = Array.isArray(draft) ? draft.length : String(draft ?? '').split('\n').filter((line) => line.trim() !== '').length
        control = h('textarea', {
          className: 'fsp-input fsp-textarea',
          rows: 4,
          value: Array.isArray(draft) ? draft.join('\n') : String(draft ?? ''),
          placeholder: '每行一项',
          'aria-label': label,
          onChange: (event) => onChange(event.target.value),
        })
        hint = `每行一项，共 ${lines} 项 · 元素类型 ${field.itemType ?? 'string'}`
      } else {
        control = h('input', {
          type: 'text',
          className: 'fsp-input',
          value: draft === undefined || draft === null ? '' : String(draft),
          'aria-label': label,
          onChange: (event) => onChange(event.target.value),
        })
      }

      return h(
        'div',
        { className: 'fsp-field' },
        h(
          'div',
          null,
          h(
            'div',
            { className: 'fsp-field-title' },
            h('span', null, label),
            h('code', { className: 'fsp-field-code' }, field.name),
          ),
          help !== '' ? h('p', { className: 'fsp-field-help' }, help) : null,
          defaultText !== '' ? h('div', { className: 'fsp-field-default' }, defaultText) : null,
        ),
        h('div', { className: 'fsp-field-control' }, control, hint !== '' ? h('div', { className: 'fsp-control-hint' }, hint) : null),
      )
    }

    function SidebarIcon({ size }) {
      return h(IconBot, { size })
    }

    function valueToDraft(field) {
      if (field.type === 'array') return Array.isArray(field.value) ? field.value.slice() : []
      return field.value
    }

    function draftToValue(field, draft) {
      if (field.type === 'boolean') {
        return typeof draft === 'boolean'
          ? { ok: true, value: draft }
          : { ok: false, error: `${field.name} 必须是布尔值` }
      }
      if (field.type === 'number') {
        return typeof draft === 'number' && Number.isFinite(draft)
          ? { ok: true, value: draft }
          : { ok: false, error: `${field.name} 必须是数字` }
      }
      if (field.type === 'string') {
        return typeof draft === 'string'
          ? { ok: true, value: draft }
          : { ok: false, error: `${field.name} 必须是字符串` }
      }
      if (field.type === 'array') {
        const source = Array.isArray(draft) ? draft : String(draft ?? '').split('\n')
        const items = source.map((entry) => String(entry).trim()).filter((entry) => entry !== '')
        if (field.itemType === 'number') {
          const numbers = items.map((entry) => Number(entry))
          return numbers.every((entry) => Number.isFinite(entry))
            ? { ok: true, value: numbers }
            : { ok: false, error: `${field.name} 的元素必须是数字` }
        }
        return { ok: true, value: items }
      }
      return { ok: false, error: `${field.name} 的类型不支持` }
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            label: PANEL_LABEL,
          },
          SidebarIcon,
        ),
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          FeishuPage,
        ),
      )
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
