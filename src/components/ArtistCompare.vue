<script setup lang="ts">
/**
 * 多画师串对比:勾选若干画师串,同一提示词按顺序各出一张,网格并列展示。
 * 覆写口径:artistPrompt = 该预设 prompt;qualityTags / negative 用预设绑定值,留空回落全局覆写。
 * 顺序生成(共享单请求飞行),共用一个种子以保证公平对比。
 */
import { computed, reactive, ref } from 'vue';

import { generateNaiImage } from '@/nai/client';
import { activeEndpoint, globalQualityTags, globalUndesired, settings } from '@/state/settings';
import { naiRandomSeed } from '@/constants';
import { addHistory } from '@/state/historyList';
import { imageUrl, promptDraft } from '@/state/ui';
import { notify } from '@/st/toast';

interface CompareRow {
  presetId: string;
  name: string;
  status: 'generating' | 'done' | 'error';
  error: string;
  imageId: string;
  seed: number;
}

const selected = ref<string[]>([]);
const running = ref(false);
const rows = reactive<CompareRow[]>([]);
const urls = reactive<Record<string, string>>({});

const selectedCount = computed(() => selected.value.length);

function toggleAll(v: boolean): void {
  selected.value = v ? settings.artistPresets.map(a => a.id) : [];
}

function rowOf(presetId: string): CompareRow | undefined {
  return rows.find(r => r.presetId === presetId);
}

async function run(): Promise<void> {
  if (running.value) return;
  const presets = settings.artistPresets.filter(a => selected.value.includes(a.id));
  if (!presets.length) {
    notify('warning', '先勾选要对比的画师串');
    return;
  }
  if (!promptDraft.text.trim()) {
    notify('warning', '先在「生成」页写正向提示词');
    return;
  }
  if (!activeEndpoint().key.trim()) {
    notify('warning', '未配置 NAI API Key:到「设置」填写');
    return;
  }
  running.value = true;
  rows.splice(0, rows.length, ...presets.map(p => ({
    presetId: p.id,
    name: p.name,
    status: 'generating' as const,
    error: '',
    imageId: '',
    seed: 0,
  })));
  // 同一轮共用种子,画师串才是唯一变量
  const seed = settings.nai.seed > 0 ? settings.nai.seed : naiRandomSeed();
  for (const p of presets) {
    const row = rowOf(p.id)!;
    try {
      const res = await generateNaiImage({
        prompt: promptDraft.text,
        seed,
        artistPrompt: p.prompt,
        qualityTags: p.quality.trim() || globalQualityTags(),
        negative: p.negative.trim() || globalUndesired(),
      });
      await addHistory(res.meta, res.blob);
      row.imageId = res.meta.id;
      row.seed = res.meta.seed;
      row.status = 'done';
      urls[res.meta.id] = (await imageUrl(res.meta.id)) ?? '';
    } catch (e) {
      row.status = 'error';
      row.error = e instanceof Error ? e.message : String(e);
    }
  }
  running.value = false;
}
</script>

<template>
  <div class="tlb-cmp">
    <p class="tlb-hint">
      勾选多个画师串,用「生成」页的当前正向提示词各出一张(共用一个种子),并列对比画风差异。
    </p>

    <div class="tlb-row tlb-row--wrap tlb-cmp__bar">
      <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="toggleAll(true)">全选</button>
      <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="toggleAll(false)">全不选</button>
      <span class="tlb-grow" />
      <button class="tlb-btn tlb-btn--accent" :disabled="running || !selectedCount" @click="run">
        <i :class="running ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-layer-group'" />
        {{ running ? '生成中…' : `生成对比(${selectedCount})` }}
      </button>
    </div>

    <div class="tlb-cmp__picks">
      <label v-for="a in settings.artistPresets" :key="a.id" class="tlb-cmp__pick" :class="{ 'tlb-cmp__pick--on': selected.includes(a.id) }">
        <input v-model="selected" class="tlb-checkbox" type="checkbox" :value="a.id" />
        <span class="tlb-cmp__name">{{ a.name }}</span>
        <span class="tlb-cmp__prompt" :title="a.prompt">{{ a.prompt || '(空)' }}</span>
      </label>
      <p v-if="!settings.artistPresets.length" class="tlb-hint">还没有画师串:到「设置」同步或新建。</p>
    </div>

    <div v-if="rows.length" class="tlb-cmp__grid">
      <figure v-for="row in rows" :key="row.presetId" class="tlb-cmp__cell">
        <div v-if="row.status === 'done' && urls[row.imageId]" class="tlb-cmp__img">
          <img :src="urls[row.imageId]" :alt="row.name" />
        </div>
        <div v-else-if="row.status === 'generating'" class="tlb-cmp__img tlb-cmp__img--busy">
          <i class="fa-solid fa-spinner fa-spin" />
        </div>
        <div v-else class="tlb-cmp__img tlb-cmp__img--err">
          <i class="fa-solid fa-triangle-exclamation" />
        </div>
        <figcaption>
          <strong>{{ row.name }}</strong>
          <span v-if="row.status === 'done'" class="tlb-hint">seed {{ row.seed }}</span>
          <span v-if="row.status === 'error'" class="tlb-cmp__err">{{ row.error }}</span>
        </figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.tlb-cmp {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 0;
}

.tlb-cmp__bar {
  gap: 8px;
}

.tlb-cmp__picks {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
}

.tlb-cmp__pick {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface);
  cursor: pointer;
}

.tlb-cmp__pick--on {
  border-color: var(--tlb-accent);
}

.tlb-cmp__name {
  font-weight: 600;
  flex: none;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tlb-cmp__prompt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--tlb-ink-muted);
}

.tlb-cmp__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.tlb-cmp__cell {
  margin: 0;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface);
  overflow: hidden;
}

.tlb-cmp__img {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tlb-surface-2);
  overflow: hidden;
}

.tlb-cmp__img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tlb-cmp__img--busy i {
  font-size: 22px;
  color: var(--tlb-accent);
}

.tlb-cmp__img--err {
  color: var(--tlb-danger);
  font-size: 22px;
}

.tlb-cmp__cell figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
}

.tlb-cmp__err {
  font-size: 12px;
  color: var(--tlb-danger);
  word-break: break-word;
}
</style>