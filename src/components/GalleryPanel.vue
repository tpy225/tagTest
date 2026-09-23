<script setup lang="ts">
/**
 * 画廊页:历史网格。点击 → 选中并切到生成页(触发回填);悬停显示删除。
 * favoritesOnly=true 时只显示收藏(收藏 tab 复用本组件)。
 */
import { computed, onMounted, reactive, watch } from 'vue';

import { history, loadHistory, removeHistory, toggleFavorite, wipeHistory } from '@/state/historyList';
import { imageUrl, openPanel, ui } from '@/state/ui';
import { notify } from '@/st/toast';

const props = defineProps<{ favoritesOnly?: boolean }>();

onMounted(() => {
  if (!history.loaded) void loadHistory();
});

/** 列表;收藏 tab 只看收藏。 */
const shown = computed(() => (props.favoritesOnly ? history.items.filter(i => i.favorite) : history.items));

/** id → object URL(会话级缓存在 state/ui)。有缩略图(meta.thumb)的条目不读全图,仅无缩略图的旧记录按需回落。 */
const urls = reactive<Record<string, string>>({});

watch(
  () => history.items,
  async items => {
    for (const item of items) {
      if (item.thumb) continue; // 直接用缩略图,不读全图 Blob
      if (!urls[item.id]) {
        const url = await imageUrl(item.id);
        if (url) urls[item.id] = url;
      }
    }
  },
  { immediate: true, deep: true },
);

async function pick(id: string): Promise<void> {
  ui.currentId = id;
  openPanel('gen');
}

async function remove(id: string): Promise<void> {
  await removeHistory(id);
}

function toggleFav(id: string): void {
  void toggleFavorite(id);
}

async function clearAll(): Promise<void> {
  if (!window.confirm('清空全部历史(含图片)?此操作不可恢复。')) return;
  await wipeHistory();
  notify('success', '历史已清空');
}

function timeOf(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<template>
  <div class="tlb-gal">
    <div class="tlb-row tlb-gal__bar">
      <span class="tlb-hint">{{ shown.length }} 张 · 点图选中并回填提示词</span>
      <span class="tlb-grow" />
      <button v-if="history.items.length" class="tlb-btn tlb-btn--danger tlb-btn--sm" @click="clearAll">清空全部</button>
    </div>

    <div v-if="shown.length" class="tlb-gal__grid tlb-scroll">
      <figure
        v-for="item in shown"
        :key="item.id"
        class="tlb-gal__cell"
        :class="{ 'tlb-gal__cell--on': ui.currentId === item.id }"
        @click="pick(item.id)"
      >
        <img v-if="item.thumb || urls[item.id]" :src="item.thumb || urls[item.id]" alt="" loading="lazy" />
        <div v-else class="tlb-gal__ph"><i class="fa-solid fa-spinner fa-spin" /></div>
        <figcaption class="tlb-gal__cap">
          <span class="tlb-gal__time">{{ timeOf(item.createdAt) }}</span>
          <span class="tlb-gal__seed">s{{ item.seed }}</span>
        </figcaption>
        <button
          class="tlb-gal__fav"
          :class="{ 'tlb-gal__fav--on': item.favorite }"
          :title="item.favorite ? '取消收藏' : '收藏'"
          @click.stop="toggleFav(item.id)"
        >
          <i :class="item.favorite ? 'fa-solid fa-star' : 'fa-regular fa-star'" />
        </button>
        <button class="tlb-gal__del" title="删除" @click.stop="remove(item.id)">
          <i class="fa-solid fa-trash-can" />
        </button>
      </figure>
    </div>
    <div v-else class="tlb-gal__empty">
      <i class="fa-solid fa-images" />
      <p>{{ favoritesOnly ? '还没有收藏的图片。' : '画廊空空如也。' }}</p>
    </div>
  </div>
</template>

<style scoped>
.tlb-gal {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
  min-height: 0;
}

.tlb-gal__bar {
  flex: none;
}

.tlb-gal__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  align-content: start;
  padding-right: 4px;
}

.tlb-gal__cell {
  position: relative;
  border-radius: var(--tlb-radius-sm);
  overflow: hidden;
  border: 2px solid transparent;
  background: var(--tlb-surface-2);
  cursor: pointer;
  transition: border-color var(--tlb-dur) var(--tlb-ease), transform var(--tlb-dur) var(--tlb-ease);
}

.tlb-gal__cell:hover {
  transform: translateY(-2px);
}

.tlb-gal__cell--on {
  border-color: var(--tlb-accent);
}

.tlb-gal__cell img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

.tlb-gal__ph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  color: var(--tlb-ink-muted);
}

.tlb-gal__cap {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11.5px;
  color: var(--tlb-ink-soft);
  background: var(--tlb-surface);
}

.tlb-gal__seed {
  font-family: var(--tlb-font-mono);
}

.tlb-gal__fav {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-overlay);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--tlb-dur) var(--tlb-ease);
}

.tlb-gal__cell:hover .tlb-gal__fav {
  opacity: 1;
}

.tlb-gal__fav--on {
  opacity: 1;
  color: var(--tlb-warning);
}

.tlb-gal__del {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-overlay);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--tlb-dur) var(--tlb-ease);
}

.tlb-gal__cell:hover .tlb-gal__del {
  opacity: 1;
}

.tlb-gal__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--tlb-ink-muted);
  padding: 60px 0;
}

.tlb-gal__empty i {
  font-size: 34px;
}
</style>
