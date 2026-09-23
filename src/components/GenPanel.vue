<script setup lang="ts">
/**
 * 生成主界面(默认视图,非底栏 tab)。
 * 布局对齐设计图:左侧 = 画师串预设 + 画师串输入框 + 正面/负面提示词 + AI 生成/NAI 生成;
 * 右侧 = Vibe Transfer(占位);下方 = 图片大图(滑动切换 + 回填)。
 * 回填口径:滑到某张历史图时,把它的**原始正向词**填回编辑框(不含画师串/质量词)。
 */
import { computed, onMounted, ref, watch } from 'vue';

import { buildFullPrompt, buildNaiv4vibe, encodeVibeImage, generateNaiImage, parseNaiv4vibe } from '@/nai/client';
import { chat, extractTags } from '@/nai/bot';
import { vibeModelKey } from '@/constants';
import { activeArtistPreset, activeEndpoint, artistStore, newId, settings } from '@/state/settings';
import { addHistory, currentItem, history, loadHistory, stepSelection } from '@/state/historyList';
import { imageUrl, makeThumbnail, openPanel, promptDraft, ui } from '@/state/ui';
import { addVibe, loadVibes, removeVibe, updateVibe, vibeList } from '@/state/vibeList';
import { getBaibaiCharacters } from '@/sync/baibai';
import { notify } from '@/st/toast';
import type { TlbHistoryMeta, TlbVibe } from '@/types';

const seedInput = ref('0');
const showParams = ref(false);

const status = ref('');
const generating = ref(false);
const botGen = ref(false);
const error = ref('');

/* ---- 角色 tag 一键插入(读柏宝绘角色库) ---- */
const characters = ref<{ name: string; tag: string }[]>([]);
const selectedChar = ref('');
const loadingChars = ref(false);

function loadCharacters(): void {
  loadingChars.value = true;
  try {
    characters.value = getBaibaiCharacters();
    if (!characters.value.length) {
      notify('warning', '柏宝绘没有可用的角色库(或未安装)');
    } else if (!characters.value.some(c => c.name === selectedChar.value)) {
      selectedChar.value = characters.value[0].name;
    }
  } catch (e) {
    characters.value = [];
    notify('error', e instanceof Error ? e.message : String(e));
  } finally {
    loadingChars.value = false;
  }
}

function insertCharacterTag(): void {
  const c = characters.value.find(x => x.name === selectedChar.value);
  if (!c) {
    notify('warning', '先选择一个角色');
    return;
  }
  promptDraft.text = promptDraft.text.trim() ? `${promptDraft.text.trim()}, ${c.tag}` : c.tag;
  notify('success', `已插入「${c.name}」的 tag`);
}

onMounted(() => {
  if (!history.loaded) void loadHistory();
  if (!vibeList.loaded) void loadVibes();
});

/* ---- 画师串:下拉选预设 → 输入框回填;编辑即时写回预设 ---- */
const artistPrompt = computed({
  get: () => activeArtistPreset()?.prompt ?? '',
  set: (v: string) => {
    const p = activeArtistPreset();
    if (p) p.prompt = v;
  },
});

function addArtist(): void {
  const item = artistStore.add();
  settings.activeArtistId = item.id;
  notify('success', '已新建画师串,在输入框里直接编辑');
}

function duplicateArtist(): void {
  const p = activeArtistPreset();
  if (!p) {
    notify('warning', '先选择一个画师串');
    return;
  }
  const copy = artistStore.duplicate(p.id);
  if (copy) settings.activeArtistId = copy.id;
}

function removeArtist(): void {
  const p = activeArtistPreset();
  if (!p) return;
  if (!window.confirm(`删除画师串「${p.name}」?`)) return;
  artistStore.remove(p.id);
}

function manageArtists(): void {
  openPanel('settings');
}

/* ---- 复制 ---- */
async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify('success', `${label}已复制`);
  } catch {
    notify('error', '复制失败(浏览器未授权剪贴板)');
  }
}

/* ---- 当前图与 URL ---- */
const current = computed<TlbHistoryMeta | null>(() => currentItem());
const currentUrl = ref<string | null>(null);

watch(
  () => ui.currentId,
  async id => {
    currentUrl.value = id ? await imageUrl(id) : null;
    if (id) backfill(current.value);
  },
  { immediate: true },
);

watch(history, () => {
  const id = ui.currentId;
  if (id && !urlKeyed(id)) {
    void imageUrl(id).then(u => (currentUrl.value = u));
  }
});

function urlKeyed(id: string): boolean {
  return current.value?.id === id;
}

/** 滑动/切换选中 → 回填原始正向词。 */
function backfill(meta: TlbHistoryMeta | null): void {
  if (!meta) return;
  promptDraft.text = meta.rawPrompt;
  seedInput.value = String(meta.seed);
  error.value = '';
}

/* ---- 滑动手势 ---- */
const previewEl = ref<HTMLElement | null>(null);
let swipeStart: { x: number; y: number } | null = null;

function onSwipeDown(e: PointerEvent): void {
  swipeStart = { x: e.clientX, y: e.clientY };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onSwipeMove(e: PointerEvent): void {
  if (!swipeStart) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    stepSelection(dx < 0 ? 1 : -1); // 左滑 = 更旧,右滑 = 更新
    swipeStart = null;
  }
}

function onSwipeUp(): void {
  swipeStart = null;
}

/* ---- NAI 生成(把提示词发出去出图) ---- */
async function generate(): Promise<void> {
  if (generating.value) return;
  error.value = '';
  generating.value = true;
  status.value = '生成中…';
  try {
    const seed = Number.parseInt(seedInput.value, 10);
    const result = await generateNaiImage({
      prompt: promptDraft.text,
      seed: Number.isFinite(seed) && seed > 0 ? seed : undefined,
    });
    seedInput.value = String(result.meta.seed);
    await addHistory(result.meta, result.blob);
    status.value = `完成 · ${result.meta.width}×${result.meta.height} · seed ${result.meta.seed}`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    status.value = '';
  } finally {
    generating.value = false;
  }
}

/* ---- AI 生成 = Bot 把自然语言转成 tag,填入提示词 ---- */
async function aiGenerate(): Promise<void> {
  const desc = promptDraft.text.trim();
  if (!desc) {
    notify('warning', '先在正面提示词里写自然语言描述');
    return;
  }
  if (!settings.bot.baseUrl.trim() || !settings.bot.key.trim()) {
    notify('warning', '未配置 Bot:到「设置」填接口地址与 Key');
    return;
  }
  botGen.value = true;
  try {
    const reply = await chat([{ role: 'user', content: desc }]);
    const tags = extractTags(reply);
    if (!tags) {
      notify('warning', 'Bot 没返回可用的 tag');
      return;
    }
    promptDraft.text = tags;
    notify('success', '已用 Bot 生成 tag,再点「NAI 生成」出图');
  } catch (e) {
    notify('error', e instanceof Error ? e.message : String(e));
  } finally {
    botGen.value = false;
  }
}

const seedPlaceholder = computed(() => (settings.nai.seed > 0 ? `面板默认 ${settings.nai.seed}` : '随机'));

/* ---- Vibe Transfer(直连生效,右侧面板;可单独或多勾选) ---- */
const encoding = ref(false);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

async function onVibeImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = parseNaiv4vibe(await file.text());
    let thumb = parsed.thumbnail;
    if (!thumb && parsed.image) thumb = await makeThumbnail(`data:image/png;base64,${parsed.image}`);
    const vibe: TlbVibe = {
      id: newId('vibe'),
      name: parsed.name,
      image: parsed.image,
      thumbnail: thumb,
      encodings: parsed.encodings,
      strength: parsed.strength,
      enabled: true,
      createdAt: Date.now(),
    };
    await addVibe(vibe);
    notify('success', `已导入 vibe「${parsed.name}」`);
  } catch (err) {
    notify('error', err instanceof Error ? err.message : String(err));
  }
}

async function onVibeEncodeFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || encoding.value) return;
  encoding.value = true;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const imageBase64 = dataUrlToBase64(dataUrl);
    if (!imageBase64) throw new Error('无法解析图片数据');
    const encoded = await encodeVibeImage(imageBase64);
    const thumbnail = await makeThumbnail(dataUrl);
    const modelKey = vibeModelKey(settings.nai.model);
    const vibe: TlbVibe = {
      id: newId('vibe'),
      name: file.name.replace(/\.[^.]+$/, '') || '新 Vibe',
      image: imageBase64,
      thumbnail,
      encodings: { [modelKey]: { encoding: encoded, infoExtracted: 1 } },
      strength: 0.5,
      enabled: true,
      createdAt: Date.now(),
    };
    await addVibe(vibe);
    notify('success', `已编码并添加 vibe「${vibe.name}」`);
  } catch (err) {
    notify('error', err instanceof Error ? err.message : String(err));
  } finally {
    encoding.value = false;
  }
}

function exportVibe(vibe: TlbVibe): void {
  const json = buildNaiv4vibe(vibe);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${vibe.name.replace(/[^\w\u4e00-\u9fff-]+/g, '_') || 'vibe'}.naiv4vibe`;
  a.click();
  URL.revokeObjectURL(url);
}

async function onVibeToggle(vibe: TlbVibe): Promise<void> {
  await updateVibe(vibe);
}

async function onVibeDelete(vibe: TlbVibe): Promise<void> {
  if (!window.confirm(`删除 vibe「${vibe.name}」?`)) return;
  await removeVibe(vibe.id);
}

/** 拼装预览(实时)。 */
const assemblePreview = computed(() => buildFullPrompt(promptDraft.text || '(提示词)'));
</script>

<template>
  <div class="tlb-gen">
    <div class="tlb-gen__top">
      <!-- 左列:提示词区 -->
      <div class="tlb-gen__prompts">
        <!-- 画师串预设 -->
        <div>
          <label class="tlb-label">画师串预设</label>
          <div class="tlb-row">
            <select v-model="settings.activeArtistId" class="tlb-select tlb-grow">
              <option value="">(不使用)</option>
              <option v-for="a in settings.artistPresets" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="新建" @click="addArtist"><i class="fa-solid fa-plus" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="复制" :disabled="!activeArtistPreset()" @click="duplicateArtist"><i class="fa-solid fa-copy" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="删除" :disabled="!activeArtistPreset()" @click="removeArtist"><i class="fa-solid fa-trash-can" /></button>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="管理画师串库" @click="manageArtists"><i class="fa-solid fa-sliders" /></button>
          </div>
        </div>

        <!-- 画师串输入框 -->
        <div>
          <label class="tlb-label">画师串输入框 <span class="tlb-hint">(编辑后即时保存到该预设)</span></label>
          <textarea
            v-model="artistPrompt"
            class="tlb-textarea"
            rows="2"
            :disabled="!activeArtistPreset()"
            :placeholder="activeArtistPreset() ? '画师/画风 tag,如:artist:xxx, ...' : '先选择或新建一个画师串预设'"
          />
        </div>

        <!-- 角色 tag 一键插入 -->
        <div>
          <div class="tlb-row">
            <label class="tlb-label">角色 tag <span class="tlb-hint">(读柏宝绘角色库)</span></label>
            <span class="tlb-grow" />
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" :disabled="loadingChars" @click="loadCharacters">
              <i :class="loadingChars ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-users'" />
              拉取角色
            </button>
          </div>
          <div v-if="characters.length" class="tlb-row">
            <select v-model="selectedChar" class="tlb-select tlb-grow">
              <option v-for="c in characters" :key="c.name" :value="c.name">{{ c.name }}</option>
            </select>
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="把该角色 tag 填入正面提示词" @click="insertCharacterTag">
              <i class="fa-solid fa-reply" /> 插入
            </button>
          </div>
        </div>

        <!-- 正面提示词 -->
        <div>
          <div class="tlb-row">
            <label class="tlb-label">正面提示词</label>
            <span class="tlb-grow" />
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="复制" @click="copyText(promptDraft.text, '正面提示词')"><i class="fa-solid fa-copy" /></button>
          </div>
          <textarea
            v-model="promptDraft.text"
            class="tlb-textarea"
            rows="4"
            placeholder="画面 tag,或自然语言描述(AI 生成会转成 tag)"
            @keydown.meta.enter="generate"
            @keydown.ctrl.enter="generate"
          />
          <div class="tlb-row tlb-gen__actions">
            <button class="tlb-btn tlb-btn--accent tlb-grow" :disabled="botGen || generating" @click="aiGenerate">
              <i :class="botGen ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-wand-sparkles'" />
              {{ botGen ? '生成 tag…' : 'AI 生成' }}
            </button>
            <button class="tlb-btn tlb-btn--accent tlb-grow" :disabled="generating" @click="generate">
              <i :class="generating ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-image'" />
              {{ generating ? '生成中…' : 'NAI 生成' }}
            </button>
          </div>
        </div>

        <!-- 负面提示词 -->
        <div>
          <div class="tlb-row">
            <label class="tlb-label">负面提示词 <span class="tlb-hint">(覆写;留空 = 官方默认)</span></label>
            <span class="tlb-grow" />
            <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="复制" @click="copyText(settings.nai.undesiredContent, '负面提示词')"><i class="fa-solid fa-copy" /></button>
          </div>
          <textarea v-model="settings.nai.undesiredContent" class="tlb-textarea" rows="2" placeholder="留空 = 按模型取官方负面词" />
        </div>

        <!-- 参数(可折叠) -->
        <button class="tlb-btn--ghost tlb-btn tlb-btn--sm tlb-gen__toggle" @click="showParams = !showParams">
          <i :class="showParams ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'" />
          参数与拼装预览
        </button>
        <div v-if="showParams" class="tlb-gen__params">
          <div class="tlb-row">
            <div class="tlb-grow">
              <label class="tlb-label">种子(0 = 随机)</label>
              <input v-model="seedInput" class="tlb-input" type="number" min="0" :placeholder="seedPlaceholder" />
            </div>
          </div>
          <p class="tlb-hint">尺寸与步骤/CFG/采样器在「设置」里调;当前 {{ settings.nai.portraitSize }} · {{ settings.nai.model }}</p>
          <p class="tlb-hint tlb-gen__assemble" :title="assemblePreview">拼装预览:{{ assemblePreview }}</p>
        </div>

        <p v-if="status && !error" class="tlb-hint">{{ status }}</p>
        <p v-if="error" class="tlb-gen__error">{{ error }}</p>
        <p v-if="!activeEndpoint().key" class="tlb-hint">未配置 API Key:到「设置」填写,或点「从柏宝绘同步」。</p>
      </div>

      <!-- 右列:Vibe Transfer(直连生效;可单独勾选或多勾选) -->
      <aside class="tlb-vibe">
        <div class="tlb-row tlb-vibe__head">
          <h3 class="tlb-vibe__title">Vibe Transfer</h3>
          <span class="tlb-grow" />
          <label class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="导入 .naiv4vibe 文件">
            <i class="fa-solid fa-file-import" />
            <input type="file" accept=".naiv4vibe,application/json,.json" style="display: none" @change="onVibeImportFile" />
          </label>
          <label class="tlb-btn tlb-btn--ghost tlb-btn--sm" :title="encoding ? '编码中…' : '编码新图片为 vibe'">
            <i :class="encoding ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-wand-magic-sparkles'" />
            <input type="file" accept="image/*" style="display: none" :disabled="encoding" @change="onVibeEncodeFile" />
          </label>
        </div>

        <div class="tlb-vibe__list">
          <p v-if="encoding" class="tlb-hint tlb-vibe__empty"><i class="fa-solid fa-spinner fa-spin" /><br />正在编码…</p>
          <template v-else-if="vibeList.items.length || !vibeList.loaded">
            <div v-for="v in vibeList.items" :key="v.id" class="tlb-vibe__item" :class="{ 'tlb-vibe__item--on': v.enabled }">
              <div class="tlb-vibe__thumb">
                <img v-if="v.thumbnail" :src="v.thumbnail" :alt="v.name" />
                <i v-else class="fa-solid fa-image" />
              </div>
              <div class="tlb-vibe__body">
                <div class="tlb-row">
                  <span class="tlb-vibe__name" :title="v.name">{{ v.name }}</span>
                  <span class="tlb-grow" />
                  <input v-model="v.enabled" class="tlb-checkbox" type="checkbox" :title="v.enabled ? '已叠加' : '不叠加'" @change="onVibeToggle(v)" />
                </div>
                <div class="tlb-row tlb-vibe__strength">
                  <input v-model.number="v.strength" class="tlb-vibe__slider" type="range" min="0" max="1" step="0.05" title="参考强度" @change="onVibeToggle(v)" />
                  <span class="tlb-hint">{{ (v.strength * 100).toFixed(0) }}%</span>
                </div>
                <div class="tlb-row">
                  <span class="tlb-vibe__keys" :title="Object.keys(v.encodings).join(', ')">{{ Object.keys(v.encodings).join(', ') || '无编码' }}</span>
                  <span class="tlb-grow" />
                  <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="导出 .naiv4vibe" @click="exportVibe(v)"><i class="fa-solid fa-file-export" /></button>
                  <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="删除" @click="onVibeDelete(v)"><i class="fa-solid fa-trash-can" /></button>
                </div>
              </div>
            </div>
            <p v-if="!vibeList.items.length" class="tlb-hint tlb-vibe__empty">加载中…</p>
          </template>
          <p v-else class="tlb-hint tlb-vibe__empty">
            <i class="fa-solid fa-image" /><br />
            还没有 vibe。导入 .naiv4vibe 文件,或点右上角魔杖用参考图编码一个。
          </p>
        </div>
      </aside>
    </div>

    <!-- 图片大图:滑动切换 + 回填 -->
    <div
      ref="previewEl"
      class="tlb-gen__preview"
      @pointerdown="onSwipeDown"
      @pointermove="onSwipeMove"
      @pointerup="onSwipeUp"
      @pointercancel="onSwipeUp"
    >
      <img v-if="currentUrl" :src="currentUrl" alt="" draggable="false" />
      <div v-else class="tlb-gen__empty">
        <i class="fa-solid fa-image" />
        <p>还没有图片。写好提示词,点下方「NAI 生成」。</p>
      </div>

      <template v-if="history.items.length > 1">
        <button class="tlb-gen__nav tlb-gen__nav--l" title="上一张(更新)" @click="stepSelection(-1)">
          <i class="fa-solid fa-chevron-left" />
        </button>
        <button class="tlb-gen__nav tlb-gen__nav--r" title="下一张(更旧)" @click="stepSelection(1)">
          <i class="fa-solid fa-chevron-right" />
        </button>
        <span class="tlb-gen__count">{{ history.items.findIndex(i => i.id === ui.currentId) + 1 }} / {{ history.items.length }}</span>
      </template>

      <span v-if="current" class="tlb-gen__badge">
        {{ current.width }}×{{ current.height }} · seed {{ current.seed }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.tlb-gen {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 0;
}

.tlb-gen__top {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 14px;
  align-items: start;
}

.tlb-gen__prompts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tlb-gen__actions {
  margin-top: 8px;
  gap: 8px;
}

.tlb-gen__toggle {
  align-self: flex-start;
  margin-top: 2px;
}

.tlb-gen__params {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px dashed var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
}

.tlb-gen__assemble {
  word-break: break-all;
}

.tlb-gen__error {
  color: var(--tlb-danger);
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
}

.tlb-gen__preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  max-height: 44vh;
  border-radius: var(--tlb-radius);
  background: var(--tlb-surface-2);
  border: 1px solid var(--tlb-line);
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
}

.tlb-gen__preview img {
  max-width: 100%;
  max-height: 44vh;
  object-fit: contain;
  pointer-events: none;
}

.tlb-gen__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--tlb-ink-muted);
  padding: 40px 0;
}

.tlb-gen__empty i {
  font-size: 34px;
}

.tlb-gen__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 34px;
  height: 34px;
  border: none;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-overlay);
  color: #fff;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity var(--tlb-dur) var(--tlb-ease);
}

.tlb-gen__nav:hover {
  opacity: 1;
}

.tlb-gen__nav--l {
  left: 10px;
}

.tlb-gen__nav--r {
  right: 10px;
}

.tlb-gen__count {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-overlay);
  color: #fff;
}

.tlb-gen__badge {
  position: absolute;
  bottom: 8px;
  left: 10px;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-overlay);
  color: #fff;
}

/* Vibe Transfer(右侧内联面板) */
.tlb-vibe {
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius);
  background: var(--tlb-surface);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 100%;
}

.tlb-vibe__head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--tlb-line);
}

.tlb-vibe__title {
  font-size: 13.5px;
  font-weight: 700;
}

.tlb-vibe__list {
  min-height: 120px;
  max-height: 46vh;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tlb-vibe__empty {
  text-align: center;
  line-height: 1.7;
  margin: auto;
}

.tlb-vibe__empty i {
  font-size: 26px;
  opacity: 0.6;
  margin-bottom: 8px;
}

.tlb-vibe__item {
  display: flex;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface);
}

.tlb-vibe__item--on {
  border-color: var(--tlb-accent);
}

.tlb-vibe__thumb {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: var(--tlb-radius-sm);
  background: var(--tlb-surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.tlb-vibe__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tlb-vibe__thumb i {
  opacity: 0.6;
}

.tlb-vibe__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tlb-vibe__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tlb-vibe__strength {
  gap: 6px;
}

.tlb-vibe__slider {
  flex: 1;
  min-width: 0;
}

.tlb-vibe__keys {
  font-size: 11px;
  color: var(--tlb-ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>