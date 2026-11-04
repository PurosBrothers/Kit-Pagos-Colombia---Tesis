export interface OrderPayload {
  id: string;
  total: number;
}

export function externalHelper(msg: string): string {
  return msg;
}
