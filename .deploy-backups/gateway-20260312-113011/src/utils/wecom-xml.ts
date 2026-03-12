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
  PicUrl?: string;
  MediaId?: string;
  ThumbMediaId?: string;
  Location_X?: string;
  Location_Y?: string;
  Label?: string;
  Title?: string;
  Description?: string;
  Url?: string;
}

export interface WeComIncomingMessage {
  toUserName: string;
  fromUserName: string;
  msgType: string;
  content: string;
  msgId?: string;
  picUrl?: string;
  mediaId?: string;
  thumbMediaId?: string;
  locationX?: string;
  locationY?: string;
  label?: string;
  title?: string;
  description?: string;
  url?: string;
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
    picUrl: body.PicUrl,
    mediaId: body.MediaId,
    thumbMediaId: body.ThumbMediaId,
    locationX: body.Location_X,
    locationY: body.Location_Y,
    label: body.Label,
    title: body.Title,
    description: body.Description,
    url: body.Url,
    encrypt: body.Encrypt,
  };

  log.debug('XML 解析结果', {
    toUserName: result.toUserName,
    fromUserName: result.fromUserName,
    msgType: result.msgType,
    hasContent: !!result.content,
    hasMsgId: !!result.msgId,
    hasMediaId: !!result.mediaId,
    hasPicUrl: !!result.picUrl,
    hasUrl: !!result.url,
    hasEncrypt: !!result.encrypt,
  });

  return result;
}
