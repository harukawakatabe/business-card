/**
 * 档案存取：服务器为准（登录用户一人一份），localStorage 只做缓存和离线兜底。
 * 存的仍是页面原来的整份 JSON，服务器不拆解内容；旧的无用户名键在首次保存后
 * 自然迁上服务器（loadStore 读得到 legacy、saveStore 写的是远端 + 按用户缓存）。
 */
import { userKey } from "./auth.js";

const pending = new Map(); // key → { value, timer }

async function push(key, value, keepalive) {
  try {
    await fetch("/api/store", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, data: value }),
      keepalive,
    });
  } catch {
    /* 存不进服务器就留在缓存里，下次保存再试 */
  }
}

function cache(key, value) {
  try {
    localStorage.setItem(userKey(key), JSON.stringify(value));
  } catch {
    /* 配额满了就不缓存，服务器那份还在 */
  }
}

export async function loadStore(key) {
  let remote = null;
  try {
    const res = await fetch(`/api/store?key=${key}`);
    if (res.ok) remote = (await res.json()).data || null;
  } catch {
    /* 服务器没应声，退回本地 */
  }
  if (remote) {
    cache(key, remote);
    return remote;
  }
  // 服务器没有：按用户的缓存 → 登录时代之前的旧键（顺手当迁移源）
  for (const k of [userKey(key), key]) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) return JSON.parse(raw);
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}

export function saveStore(key, value) {
  cache(key, value);
  const hit = pending.get(key) || { value, timer: 0 };
  hit.value = value;
  clearTimeout(hit.timer);
  // 敲一个字存一次太吵，攒 600ms；丢了最多丢最后半秒
  hit.timer = setTimeout(() => flushStore(key), 600);
  pending.set(key, hit);
}

export function flushStore(key) {
  const hit = pending.get(key);
  if (!hit) return;
  clearTimeout(hit.timer);
  pending.delete(key);
  return push(key, hit.value, false);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const [key, hit] of pending) {
      clearTimeout(hit.timer);
      pending.delete(key);
      push(key, hit.value, true);
    }
  });
}
