import { CURRENCY } from '../client.config';

// 3-decimal JOD everywhere — do not change the precision.
export const money = (n) => `${(Number(n) || 0).toFixed(3)} ${CURRENCY}`;
