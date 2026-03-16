const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function createId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let suffix = "";

  for (const byte of bytes) {
    suffix += BASE62[byte % BASE62.length];
  }

  return `${prefix}_${suffix}`;
}

export function createApiKey(deployId: string): string {
  return `${deployId}_${createId("key").slice(4)}`;
}

