import express from 'express';

import { WeComCrypto } from './utils/wecom-crypto.js';
import { parseWeComXml } from './utils/wecom-xml.js';
import { createLogger } from './utils/logger.js';
import { allowList } from './utils/allow-list.js';
import { buildFeishuStatusSummary } from './utils/feishu-status.js';
import { normalizeFeishuIncomingMessage, normalizeWeComIncomingMessage } from './utils/message-normalizer.js';

const log = createLogger('App');

interface AppDeps {
  wecomEnabled: boolean;
  feishuEnabled?: boolean;
  wecomCrypto?: WeComCrypto;
  allowFrom: string;
  feishuVerificationToken?: string;
  feishuLongConnection?: boolean;
  feishuGroupRequireMention?: boolean;
  feishuDocBaseUrlConfigured?: boolean;
  feishuStartupHelpEnabled?: boolean;
  feishuStartupHelpAdminConfigured?: boolean;
  isDuplicateMessage: (msgId?: string) => boolean;
  /**
   * 处理文本消息，业务回复统一走主动发消息 API，无需返回值。
   * 该函数被 fire-and-forget 调用，不阻塞回调响应。
   */
  handleText: (input: {
    channel: 'wecom' | 'feishu';
    userId: string;
    content: string;
    sourceMessageId?: string;
    allowReply?: boolean;
    replyTargetId?: string;
    replyTargetType?: 'open_id' | 'chat_id';
  }) => Promise<void>;
}

interface FeishuEventDeps {
  allowFrom: string;
  feishuGroupRequireMention?: boolean;
  isDuplicateMessage: (msgId?: string) => boolean;
  handleText: AppDeps['handleText'];
}

/**
 * 从 query 中安全提取 string 类型参数
 */
function qs(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function clipText(input: string, max = 200): string {
  return input.length <= max ? input : `${input.slice(0, max)}...`;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function hasFeishuPostAtTag(value: unknown): boolean {
  const content = asObject(value);
  if (!content) {
    return false;
  }
  for (const locale of Object.values(content)) {
    const localeObject = asObject(locale);
    const rows = Array.isArray(localeObject?.content) ? localeObject.content : [];
    for (const row of rows) {
      if (!Array.isArray(row)) {
        continue;
      }
      for (const item of row) {
        const segment = asObject(item);
        if (typeof segment?.tag === 'string' && segment.tag.trim().toLowerCase() === 'at') {
          return true;
        }
      }
    }
  }
  return false;
}

function shouldHandleFeishuMessage(input: {
  chatType: string;
  messageType: string;
  rawContent: string;
  mentions: unknown;
  requireMentionInGroup: boolean;
}): boolean {
  if (!input.requireMentionInGroup || input.chatType === 'p2p' || !input.chatType) {
    return true;
  }
  if (Array.isArray(input.mentions) && input.mentions.length > 0) {
    return true;
  }
  const parsed = parseJsonObject(input.rawContent);
  if (!parsed) {
    return false;
  }
  if (typeof parsed.text_without_at_bot === 'string') {
    return true;
  }
  if (input.messageType.trim().toLowerCase() === 'post') {
    return hasFeishuPostAtTag(parsed);
  }
  return false;
}

export function dispatchFeishuMessageReceiveEvent(
  deps: FeishuEventDeps,
  event: Record<string, unknown>,
): 'success' | 'ignored' {
  const message = (event.message ?? {}) as Record<string, unknown>;
  const sender = (event.sender ?? {}) as Record<string, unknown>;
  const senderId = (sender.sender_id ?? {}) as Record<string, unknown>;
  const openId = typeof senderId.open_id === 'string' ? senderId.open_id : '';
  const messageId = typeof message.message_id === 'string' ? message.message_id : '';
  const messageType = typeof message.message_type === 'string' ? message.message_type : '';
  const chatId = typeof message.chat_id === 'string' ? message.chat_id : '';
  const chatType = typeof message.chat_type === 'string' ? message.chat_type : '';
  const rawContent = typeof message.content === 'string' ? message.content : '';
  const mentions = message.mentions;

  if (!openId || !messageId || !messageType || !rawContent) {
    return 'ignored';
  }
  if (!shouldHandleFeishuMessage({
    chatType,
    messageType,
    rawContent,
    mentions,
    requireMentionInGroup: deps.feishuGroupRequireMention !== false,
  })) {
    log.info('飞书群消息忽略：未命中 @ 触发条件', {
      openId,
      chatId: chatId || '(empty)',
      chatType: chatType || '(empty)',
      messageId,
      messageType,
    });
    return 'success';
  }

  const content = normalizeFeishuIncomingMessage(messageType, rawContent);
  if (!content) {
    return 'ignored';
  }
  const binaryType = messageType === 'image'
    || messageType === 'file'
    || messageType === 'audio'
    || messageType === 'media'
    || messageType === 'sticker';
  const contentWithMeta = binaryType ? `${content}\nmessage_id=${messageId}` : content;

  if (deps.isDuplicateMessage(`feishu:${messageId}`)) {
    return 'success';
  }
  if (!allowList(deps.allowFrom, openId)) {
    return 'success';
  }

  deps.handleText({
    channel: 'feishu',
    userId: openId,
    content: contentWithMeta,
    sourceMessageId: messageId,
    allowReply: true,
    replyTargetId: chatType === 'p2p' || !chatId ? openId : chatId,
    replyTargetType: chatType === 'p2p' || !chatId ? 'open_id' : 'chat_id',
  }).catch((err) => {
    log.error('飞书事件异步处理失败', err);
  });
  return 'success';
}

export function dispatchFeishuCardActionEvent(
  deps: FeishuEventDeps,
  event: Record<string, unknown>,
): 'success' | 'ignored' {
  const operator = (event.operator ?? {}) as Record<string, unknown>;
  const operatorId = (operator.operator_id ?? {}) as Record<string, unknown>;
  const openId = typeof operatorId.open_id === 'string'
    ? operatorId.open_id
    : (typeof operator.open_id === 'string' ? operator.open_id : '');
  const action = (event.action ?? {}) as Record<string, unknown>;
  const value = (action.value ?? {}) as Record<string, unknown>;
  const context = (event.context ?? {}) as Record<string, unknown>;
  const chatId = typeof context.chat_id === 'string' ? context.chat_id : '';
  const command = firstNonEmptyString(value.gateway_cmd, value.command, value.text) ?? '';
  log.info('飞书卡片动作入站', {
    openId,
    chatId: chatId || '(empty)',
    hasGatewayCmd: typeof value.gateway_cmd === 'string',
    hasCommand: typeof value.command === 'string',
    hasText: typeof value.text === 'string',
    commandPreview: clipText(command),
  });
  if (!openId || !command) {
    log.warn('飞书卡片动作忽略：缺少 openId 或 command', {
      openId: openId || '(empty)',
      command: command || '(empty)',
    });
    return 'ignored';
  }
  if (!allowList(deps.allowFrom, openId)) {
    log.warn('飞书卡片动作忽略：用户不在 allow list', { openId });
    return 'success';
  }
  // 卡片点击回调里的 open_message_id 不等价于普通消息的 reply message_id。
  // 继续走 reply 接口会触发飞书卡片相关错误码，因此这里统一直接发新消息。
  deps.handleText({
    channel: 'feishu',
    userId: openId,
    content: command,
    replyTargetId: chatId || openId,
    replyTargetType: chatId ? 'chat_id' : 'open_id',
  }).catch((err) => {
    log.error('飞书卡片回调异步处理失败', err);
  });
  log.info('飞书卡片动作已转发到 handleText', {
    openId,
    replyTargetId: chatId || openId,
    replyTargetType: chatId ? 'chat_id' : 'open_id',
  });
  return 'success';
}

export function createApp(deps: AppDeps) {
  const app = express();

  // WeCom 接收原始 body（XML 密文）
  if (deps.wecomEnabled) {
    app.use('/wecom/callback', express.text({ type: '*/*' }));
  }
  // Feishu 事件回调为 JSON
  const feishuWebhookEnabled = !deps.feishuLongConnection;
  if (feishuWebhookEnabled) {
    app.use('/feishu/callback', express.json({ type: '*/*' }));
  }

  // ============ 请求日志中间件 ============
  app.use((req, _res, next) => {
    log.info(`← ${req.method} ${req.path}`, {
      queryKeys: Object.keys(req.query),
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        'content-length': req.headers['content-length'],
      },
    });
    next();
  });

  // ========================= 健康检查 =========================
  app.get('/healthz', (_req, res) => {
    const feishuStatus = buildFeishuStatusSummary({
      enabled: deps.feishuEnabled,
      longConnection: deps.feishuLongConnection,
      groupRequireMention: deps.feishuGroupRequireMention,
      docBaseUrlConfigured: deps.feishuDocBaseUrlConfigured,
      startupHelpEnabled: deps.feishuStartupHelpEnabled,
      startupHelpAdminConfigured: deps.feishuStartupHelpAdminConfigured,
    });
    res.json({
      ok: true,
      channels: {
        wecom: {
          enabled: deps.wecomEnabled,
        },
        feishu: feishuStatus,
      },
    });
  });

  // ===================== GET 验证 URL =====================
  // 企业微信在配置回调 URL 时发 GET 请求验证：
  //   ?msg_signature=xxx&timestamp=xxx&nonce=xxx&echostr=xxx
  // 验签 + 解密 echostr，返回明文
  if (deps.wecomEnabled) {
    app.get('/wecom/callback', (req, res) => {
      const wecomCrypto = deps.wecomCrypto;
      if (!wecomCrypto) {
        log.error('GET /wecom/callback 缺少 WeComCrypto 依赖');
        res.status(500).type('text/plain').send('wecom not configured');
        return;
      }
      const msgSignature = qs(req.query.msg_signature);
      const timestamp = qs(req.query.timestamp);
      const nonce = qs(req.query.nonce);
      const echostr = qs(req.query.echostr);

      log.debug('GET /wecom/callback 验证请求', {
        msgSignature,
        timestamp,
        nonce,
        echostr: echostr ? `${echostr.substring(0, 20)}...` : '(empty)',
      });

      if (!msgSignature || !timestamp || !nonce || !echostr) {
        log.warn('GET /wecom/callback 缺少必要的 query 参数', {
          hasMsgSignature: !!msgSignature,
          hasTimestamp: !!timestamp,
          hasNonce: !!nonce,
          hasEchostr: !!echostr,
        });
        res.status(400).type('text/plain').send('missing params');
        return;
      }

      // 验签
      if (!wecomCrypto.verifySignature(msgSignature, timestamp, nonce, echostr)) {
        log.warn('GET /wecom/callback 签名验证失败', { msgSignature, timestamp, nonce });
        res.status(403).type('text/plain').send('signature mismatch');
        return;
      }
      log.debug('GET /wecom/callback 签名验证通过');

      // 解密 echostr
      try {
        const plainEchostr = wecomCrypto.decrypt(echostr);
        log.info('GET /wecom/callback 解密成功，返回 echostr 明文', {
          plainEchostr,
        });
        res.type('text/plain').send(plainEchostr);
      } catch (err) {
        log.error('GET /wecom/callback 解密 echostr 失败', err);
        res.status(500).type('text/plain').send('decrypt error');
      }
    });
  }

  // ==================== POST 接收消息 ====================
  // 安全模式：验签 + 解密 → 解析明文 XML → 立即返回 "success"
  // 业务回复统一走主动发消息 API (fire-and-forget)
  if (deps.wecomEnabled) {
    app.post('/wecom/callback', async (req, res) => {
      const wecomCrypto = deps.wecomCrypto;
      if (!wecomCrypto) {
        log.error('POST /wecom/callback 缺少 WeComCrypto 依赖');
        res.status(500).type('text/plain').send('wecom not configured');
        return;
      }
      const msgSignature = qs(req.query.msg_signature);
      const timestamp = qs(req.query.timestamp);
      const nonce = qs(req.query.nonce);

      log.debug('POST /wecom/callback 收到消息回调', {
        msgSignature,
        timestamp,
        nonce,
      });

      try {
        const rawBody = typeof req.body === 'string' ? req.body : '';
        if (!rawBody.trim()) {
          log.warn('POST /wecom/callback 请求 body 为空');
          res.status(400).type('text/plain').send('empty body');
          return;
        }
        log.debug('POST /wecom/callback 原始 body', {
          bodyLength: rawBody.length,
          bodyPreview: rawBody.substring(0, 200),
        });

        // 1. 从外层 XML 中提取 <Encrypt> 字段
        const outerParsed = await parseWeComXml(rawBody);
        const encrypt = outerParsed.encrypt ?? '';
        if (!encrypt) {
          log.warn('POST /wecom/callback body 中缺少 <Encrypt> 字段');
          res.status(400).type('text/plain').send('missing Encrypt');
          return;
        }
        log.debug('POST /wecom/callback 提取到 Encrypt 字段', {
          encryptLength: encrypt.length,
        });

        // 2. 验签
        if (!wecomCrypto.verifySignature(msgSignature, timestamp, nonce, encrypt)) {
          log.warn('POST /wecom/callback 签名验证失败', {
            msgSignature,
            timestamp,
            nonce,
          });
          res.status(403).type('text/plain').send('signature mismatch');
          return;
        }
        log.debug('POST /wecom/callback 签名验证通过');

        // 3. 解密
        const plainXml = wecomCrypto.decrypt(encrypt);
        log.debug('POST /wecom/callback 解密成功', {
          plainXmlLength: plainXml.length,
          plainXmlPreview: plainXml.substring(0, 200),
        });

        // 4. 解析明文 XML
        const msg = await parseWeComXml(plainXml);
        log.info('POST /wecom/callback 消息解析完成', {
          fromUser: msg.fromUserName,
          msgType: msg.msgType,
          content: msg.content ? msg.content.substring(0, 100) : '(empty)',
          msgId: msg.msgId,
        });

        // 4.1 去重（企业微信可能重试同一个 msgId）
        if (deps.isDuplicateMessage(msg.msgId)) {
          log.info('POST /wecom/callback 命中重复消息，跳过处理', {
            fromUser: msg.fromUserName,
            msgId: msg.msgId,
          });
          res.type('text/plain').send('success');
          return;
        }

        // 5. 立即返回 success，不阻塞
        res.type('text/plain').send('success');
        log.debug('POST /wecom/callback 已返回 success 响应');

        // 6. 异步处理业务（fire-and-forget）
        if (!allowList(deps.allowFrom, msg.fromUserName)) {
          log.warn('POST /wecom/callback 用户不在 allow list，忽略消息', {
            userId: msg.fromUserName,
          });
          return;
        }

        const normalizedContent = normalizeWeComIncomingMessage(msg);
        if (normalizedContent) {
          log.info('POST /wecom/callback 开始异步处理消息', {
            userId: msg.fromUserName,
            msgType: msg.msgType,
            contentLength: normalizedContent.length,
          });
          deps.handleText({ channel: 'wecom', userId: msg.fromUserName, content: normalizedContent }).catch((err) => {
            log.error('POST /wecom/callback handleText 异步处理失败', err);
          });
        } else {
          log.debug('POST /wecom/callback 跳过无法解析的消息', {
            msgType: msg.msgType,
          });
        }
      } catch (error) {
        log.error('POST /wecom/callback 回调处理异常', error);
        // 即使出错也返回 success，避免企业微信重试
        res.type('text/plain').send('success');
      }
    });
  }

  if (feishuWebhookEnabled) {
    app.post('/feishu/callback', (req, res) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const bodyType = typeof body.type === 'string' ? body.type : '';
        const header = (body.header ?? {}) as Record<string, unknown>;
        const token = typeof header.token === 'string'
          ? header.token
          : (typeof body.token === 'string' ? body.token : '');
        const eventType = typeof header.event_type === 'string' ? header.event_type : '';
        log.info('POST /feishu/callback 收到请求', {
          bodyType: bodyType || '(empty)',
          eventType: eventType || '(empty)',
          hasToken: !!token,
          topLevelKeys: Object.keys(body).slice(0, 20),
        });

        // 对所有事件类型统一做 token 校验，避免 url_verification 绕过校验。
        if (deps.feishuVerificationToken && token !== deps.feishuVerificationToken) {
          log.warn('POST /feishu/callback token 校验失败', {
            expectedConfigured: true,
            eventType: eventType || '(empty)',
          });
          res.status(403).json({ code: 403, msg: 'token mismatch' });
          return;
        }

        if (bodyType === 'url_verification') {
          const challenge = typeof body.challenge === 'string' ? body.challenge : '';
          log.info('POST /feishu/callback url_verification 通过', {
            challengePreview: clipText(challenge, 60),
          });
          res.json({ challenge });
          return;
        }

        if (eventType === 'card.action.trigger') {
          const event = (body.event ?? {}) as Record<string, unknown>;
          dispatchFeishuCardActionEvent({
            allowFrom: deps.allowFrom,
            isDuplicateMessage: deps.isDuplicateMessage,
            handleText: deps.handleText,
          }, event);
          // 飞书卡片动作回调不能复用普通事件回执格式（code/msg）。
          // 这里返回空对象，表示卡片点击已被服务端接收，由异步消息结果继续反馈给用户。
          log.info('POST /feishu/callback card.action.trigger 返回 {}');
          res.json({});
          return;
        }
        if (eventType !== 'im.message.receive_v1') {
          log.info('POST /feishu/callback 忽略非消息事件', { eventType });
          res.json({ code: 0, msg: 'ignored' });
          return;
        }

        const event = (body.event ?? {}) as Record<string, unknown>;
        const result = dispatchFeishuMessageReceiveEvent({
          allowFrom: deps.allowFrom,
          isDuplicateMessage: deps.isDuplicateMessage,
          handleText: deps.handleText,
        }, event);
        log.info('POST /feishu/callback im.message.receive_v1 处理完成', { result });
        res.json({ code: 0, msg: result });
      } catch (error) {
        log.error('POST /feishu/callback 回调处理异常', error);
        log.warn('POST /feishu/callback 异常兜底返回 success');
        res.json({ code: 0, msg: 'success' });
      }
    });
  }

  return app;
}
