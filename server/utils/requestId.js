import { randomUUID } from 'crypto';

export function generateRequestId() {
  return randomUUID().split('-')[0];
}
