import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { Config } from '../config.js';

export function seal(value: string, config: Config): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.PII_ENCRYPTION_KEY, 'base64'), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}
export function open(value: Buffer, config: Config): string {
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.PII_ENCRYPTION_KEY, 'base64'), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
}
export function digest(value: string, config: Config): Buffer {
  return createHmac('sha256', Buffer.from(config.LOOKUP_HMAC_KEY, 'base64')).update(value).digest();
}
