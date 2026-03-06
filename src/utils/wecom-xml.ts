import { parseStringPromise } from 'xml2js';
import { createLogger } from './logger.js';

const log = createLogger('WeComXml');

interface RawWeComMessage {
  ToUserName?: string;
  FromUserName?: string;
  MsgType?: string;
  Content?: string;
  MsgId?: string;
  Encrypt?: string;
}

export interface WeComIncomingMessage {
  toUserName: string;
  fromUserName: string;
  msgType: string;
  content: string;
  msgId?: string;
  /** 安全模式外层 XML 的 <Encrypt> 字段 */
  encrypt?: string;
}

export async function parseWeComXml(xml: string): Promise<WeComIncomingMessage> {
  log.debug('解析 XML', {
    xmlLength: xml.length,
    xmlPreview: xml.substring(0, 200),
  });

  const parsed = (await parseStringPromise(xml, {
    explicitArray: false,
    trim: true,
  })) as { xml?: RawWeComMessage };

  const body = parsed.xml ?? {};

  const result: WeComIncomingMessage = {
    toUserName: body.ToUserName ?? '',
    fromUserName: body.FromUserName ?? '',
    msgType: body.MsgType ?? '',
    content: body.Content ?? '',
    msgId: body.MsgId,
    encrypt: body.Encrypt,
  };

  log.debug('XML 解析结果', {
    toUserName: result.toUserName,
    fromUserName: result.fromUserName,
    msgType: result.msgType,
    hasContent: !!result.content,
    hasMsgId: !!result.msgId,
    hasEncrypt: !!result.encrypt,
  });

  return result;
}
