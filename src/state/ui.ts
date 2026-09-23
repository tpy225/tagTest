/**
 * UI 状态:面板开关、当前 tab、历史选择与图片 URL 缓存。
 * Object URL 按 id 缓存(会话级),删除历史时手动 revoke。
 */
import { reactive } from 'vue';

import { getBlob } from '@/storage/history';

export type TlbTab = 'gen' | 'compare' | 'bot' | 'gallery' | 'favorites' | 'settings';

export const ui = reactive({
  panelOpen: false,
  tab: 'gen' as TlbTab,
  /** 当前查看的历史 id(画廊选中/生成页大图);null = 最新一张。 */
  currentId: null as string | null,
});

/** 正向提示词草稿(生成页正文;Bot「填 tag」跨页写入,故提为共享状态)。 */
export const promptDraft = reactive({ text: '' });

export function openPanel(tab?: TlbTab): void {
  if (tab) ui.tab = tab;
  ui.panelOpen = true;
}

export function closePanel(): void {
  ui.panelOpen = false;
}

export function togglePanel(): void {
  ui.panelOpen = !ui.panelOpen;
}

/* ---- Object URL 缓存 ---- */

const urlCache = new Map<string, string>();

export async function imageUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function revokeImageUrl(id: string): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

/* ---- 缩略图 ---- */

/** 从 Blob 或 dataURL/URL 生成小缩略图(最长边 256,jpeg);失败返回空串。 */
export async function makeThumbnail(src: Blob | string): Promise<string> {
  const isBlob = src instanceof Blob;
  const url = isBlob ? URL.createObjectURL(src) : src;
  try {
    return await new Promise<string>(resolve => {
      const img = new Image();
      img.onerror = () => resolve('');
      img.onload = () => {
        try {
          const max = 256;
          const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve('');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch {
          resolve('');
        }
      };
      img.src = url;
    });
  } finally {
    if (isBlob) URL.revokeObjectURL(url);
  }
}
