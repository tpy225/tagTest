/**
 * Vibe 列表的会话内状态:完整条目数组 + 增删改 + 取启用集合。
 * 正文(base64 编码)就在条目里,量级小,直接全量驻留内存。
 */
import { reactive } from 'vue';

import { deleteVibe, listVibes, saveVibe } from '@/storage/vibes';
import type { TlbVibe } from '@/types';

export const vibeList = reactive<{
  items: TlbVibe[];
  loaded: boolean;
}>({
  items: [],
  loaded: false,
});

export async function loadVibes(): Promise<void> {
  vibeList.items = await listVibes();
  vibeList.loaded = true;
}

export async function addVibe(vibe: TlbVibe): Promise<void> {
  await saveVibe(vibe);
  vibeList.items.unshift(vibe);
}

/** 原地改字段后落盘(开关/强度/改名都走它)。 */
export async function updateVibe(vibe: TlbVibe): Promise<void> {
  await saveVibe(vibe);
}

export async function removeVibe(id: string): Promise<void> {
  await deleteVibe(id);
  const idx = vibeList.items.findIndex(v => v.id === id);
  if (idx >= 0) vibeList.items.splice(idx, 1);
}

/** 当前启用且强度 > 0 的 vibe(生成时叠加)。 */
export function enabledVibes(): TlbVibe[] {
  return vibeList.items.filter(v => v.enabled && v.strength > 0);
}