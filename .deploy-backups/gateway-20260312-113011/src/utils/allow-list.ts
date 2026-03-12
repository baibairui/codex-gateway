/**
 * ALLOW_FROM 规则：
 * - 空字符串 或 "*"：允许所有用户
 * - 逗号分隔列表：按精确匹配放行
 */
export function allowList(allowFrom: string, userId: string): boolean {
  const rule = allowFrom.trim();
  if (!rule || rule === '*') {
    return true;
  }

  const users = rule
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return users.includes(userId);
}
