import express from 'express';

import { WeComCrypto } from './utils/wecom-crypto.js';
import { parseWeComXml } from './utils/wecom-xml.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('App');

interface AppDeps {
  wecomCrypto: WeComCrypto;
  /**
   * 处理文本消息，业务回复统一走主动发消息 API，无需返回值。
   * 该函数被 fire-and-forget 调用，不阻塞回调响应。
   */
  handleText: (input: { userId: string; content: string }) => Promise<void>;
}

/**
 * 从 query 中安全提取 string 类型参数
 */
function qs(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

export function createApp(deps: AppDeps) {
  const app = express();

  // 接收原始 body（XML 密文）
  app.use(express.text({ type: '*/*' }));

  // ============ 请求日志中间件 ============
  app.use((req, _res, next) => {
    log.info(`← ${req.method} ${req.path}`, {
      query: req.query,
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
    res.json({ ok: true });
  });

  // ===================== GET 验证 URL =====================
  // 企业微信在配置回调 URL 时发 GET 请求验证：
  //   ?msg_signature=xxx&timestamp=xxx&nonce=xxx&echostr=xxx
  // 验签 + 解密 echostr，返回明文
  app.get('/wecom/callback', (req, res) => {
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
    if (!deps.wecomCrypto.verifySignature(msgSignature, timestamp, nonce, echostr)) {
      log.warn('GET /wecom/callback 签名验证失败', { msgSignature, timestamp, nonce });
      res.status(403).type('text/plain').send('signature mismatch');
      return;
    }
    log.debug('GET /wecom/callback 签名验证通过');

    // 解密 echostr
    try {
      const plainEchostr = deps.wecomCrypto.decrypt(echostr);
      log.info('GET /wecom/callback 解密成功，返回 echostr 明文', {
        plainEchostr,
      });
      res.type('text/plain').send(plainEchostr);
    } catch (err) {
      log.error('GET /wecom/callback 解密 echostr 失败', err);
      res.status(500).type('text/plain').send('decrypt error');
    }
  });

  // ==================== POST 接收消息 ====================
  // 安全模式：验签 + 解密 → 解析明文 XML → 立即返回 "success"
  // 业务回复统一走主动发消息 API (fire-and-forget)
  app.post('/wecom/callback', async (req, res) => {
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
      if (!deps.wecomCrypto.verifySignature(msgSignature, timestamp, nonce, encrypt)) {
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
      const plainXml = deps.wecomCrypto.decrypt(encrypt);
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

      // 5. 立即返回 success，不阻塞
      res.type('text/plain').send('success');
      log.debug('POST /wecom/callback 已返回 success 响应');

      // 6. 异步处理业务（fire-and-forget）
      if (msg.msgType === 'text' && msg.content.trim()) {
        log.info('POST /wecom/callback 开始异步处理文本消息', {
          userId: msg.fromUserName,
          contentLength: msg.content.length,
        });
        deps.handleText({ userId: msg.fromUserName, content: msg.content }).catch((err) => {
          log.error('POST /wecom/callback handleText 异步处理失败', err);
        });
      } else {
        log.debug('POST /wecom/callback 跳过非文本消息或空消息', {
          msgType: msg.msgType,
          hasContent: !!msg.content.trim(),
        });
      }
    } catch (error) {
      log.error('POST /wecom/callback 回调处理异常', error);
      // 即使出错也返回 success，避免企业微信重试
      res.type('text/plain').send('success');
    }
  });

  return app;
}
