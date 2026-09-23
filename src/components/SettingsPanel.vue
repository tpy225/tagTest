<script setup lang="ts">
/**
 * 设置页:柏宝绘手动同步 / NAI 接入点 / 生图参数 / 词覆写与拼装 / 画师串库 / 外观 / 数据。
 * 所有改动即时落盘(state/settings.ts 的 watch 负责),无「保存」按钮。
 */
import { computed, ref } from 'vue';

import {
  NAI_MODELS,
  NAI_NOISE_SCHEDULES,
  OFFICIAL_ENDPOINT_ID,
  naiDefaultQualityTags,
  naiDefaultUndesired,
} from '@/constants';
import { samplersForModel, testConnection } from '@/nai/client';
import { listModels } from '@/nai/bot';
import { artistStore, newId, settings } from '@/state/settings';
import { history, wipeHistory } from '@/state/historyList';
import { promptDraft } from '@/state/ui';
import { notify } from '@/st/toast';
import { openBaibaiArtistManager, pushArtistsToBaibai, syncFromBaibai } from '@/sync/baibai';
import type { TlbArtistPreset, TlbPromptTemplate } from '@/types';

/* ---- 柏宝绘同步 ---- */
const syncing = ref(false);

function syncTime(ts: number): string {
  if (!ts) return '从未同步';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sync(): void {
  syncing.value = true;
  try {
    const r = syncFromBaibai();
    notify(
      'success',
      `同步完成:接入点 ${r.endpoints} 条,画师串新增 ${r.artistsImported} 条、更新 ${r.artistsUpdated} 条`,
    );
  } catch (e) {
    notify('error', e instanceof Error ? e.message : String(e));
  } finally {
    syncing.value = false;
  }
}

/* ---- 接入点 ---- */
const epName = ref('');
const epUrl = ref('');
const epKey = ref('');
const testing = ref(false);
const testMsg = ref('');

function isOfficial(id: string): boolean {
  return id === OFFICIAL_ENDPOINT_ID;
}

function addEndpoint(): void {
  if (!epUrl.value.trim()) {
    notify('warning', '请填写接口地址');
    return;
  }
  settings.nai.endpoints.push({
    id: newId('ep'),
    name: epName.value.trim() || '自定义接入点',
    url: epUrl.value.trim(),
    key: epKey.value.trim(),
  });
  epName.value = '';
  epUrl.value = '';
  epKey.value = '';
}

function removeEndpoint(id: string): void {
  if (isOfficial(id)) return;
  const idx = settings.nai.endpoints.findIndex(e => e.id === id);
  if (idx < 0) return;
  settings.nai.endpoints.splice(idx, 1);
  if (settings.nai.activeEndpointId === id) settings.nai.activeEndpointId = settings.nai.endpoints[0].id;
}

async function test(): Promise<void> {
  testing.value = true;
  testMsg.value = '';
  try {
    testMsg.value = await testConnection();
    notify('success', testMsg.value);
  } catch (e) {
    testMsg.value = e instanceof Error ? e.message : String(e);
    notify('error', testMsg.value);
  } finally {
    testing.value = false;
  }
}

/* ---- 画师串库 ---- */
const editingId = ref<string | null>(null);

function edit(id: string): void {
  editingId.value = editingId.value === id ? null : id;
}

function duplicate(id: string): void {
  const copy = artistStore.duplicate(id);
  if (copy) editingId.value = copy.id;
}

/* ---- 词覆写显示 ---- */
const qualityDefault = computed(() => naiDefaultQualityTags(settings.nai.model));
const undesiredDefault = computed(() => naiDefaultUndesired(settings.nai.model));

function resetQuality(): void {
  settings.nai.qualityTags = '';
}

function resetUndesired(): void {
  settings.nai.undesiredContent = '';
}

/* ---- Bot 拉取模型 ---- */
const botModels = ref<string[]>([]);
const botLoading = ref(false);

async function fetchBotModels(): Promise<void> {
  botLoading.value = true;
  try {
    botModels.value = await listModels();
    if (botModels.value.length && !settings.bot.model.trim()) {
      settings.bot.model = botModels.value[0];
    }
    notify('success', `拉到 ${botModels.value.length} 个模型`);
  } catch (e) {
    notify('error', e instanceof Error ? e.message : String(e));
  } finally {
    botLoading.value = false;
  }
}

/* ---- 回传画师串 ---- */
const pushing = ref(false);

function pushArtists(): void {
  pushing.value = true;
  try {
    const r = pushArtistsToBaibai();
    notify('success', `已回传 ${r.written} 条画师串(合并后共 ${r.total} 条)。请刷新页面让柏宝绘生效`);
  } catch (e) {
    notify('error', e instanceof Error ? e.message : String(e));
  } finally {
    pushing.value = false;
  }
}

function openArtistMgr(): void {
  try {
    openBaibaiArtistManager();
  } catch (e) {
    notify('error', e instanceof Error ? e.message : String(e));
  }
}

/* ---- 提示词模板库 ---- */
const editingTplId = ref<string | null>(null);

function addTemplate(): void {
  const t: TlbPromptTemplate = { id: newId('tpl'), name: '新模板', text: '' };
  settings.promptTemplates.push(t);
  editingTplId.value = t.id;
}

function fillTemplate(text: string, target: 'pos' | 'neg'): void {
  if (!text.trim()) {
    notify('warning', '模板内容为空');
    return;
  }
  if (target === 'pos') {
    promptDraft.text = promptDraft.text.trim() ? `${promptDraft.text.trim()}, ${text.trim()}` : text.trim();
    notify('success', '已填入正向提示词(切回「生成」页查看)');
  } else {
    settings.nai.undesiredContent = settings.nai.undesiredContent.trim()
      ? `${settings.nai.undesiredContent.trim()}, ${text.trim()}`
      : text.trim();
    notify('success', '已填入负面词覆写');
  }
}

/* ---- 导入 / 导出 JSON ---- */
function downloadJson(): void {
  const payload = {
    type: 'st-taglab-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    artistPresets: settings.artistPresets,
    promptTemplates: settings.promptTemplates,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `taglab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function mergeByKey<T extends { id: string }>(list: T[], incoming: T[]): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    if (!item || typeof item.id !== 'string') continue;
    const exist = list.find(x => x.id === item.id);
    if (exist) {
      Object.assign(exist, item);
      updated++;
    } else {
      list.push(item);
      added++;
    }
  }
  return { added, updated };
}

function importJson(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result)) as {
        artistPresets?: TlbArtistPreset[];
        promptTemplates?: TlbPromptTemplate[];
      };
      let msg = '';
      if (Array.isArray(data.artistPresets) && data.artistPresets.length) {
        const r = mergeByKey(settings.artistPresets, data.artistPresets);
        msg += `画师串新增 ${r.added}、更新 ${r.updated};`;
      }
      if (Array.isArray(data.promptTemplates) && data.promptTemplates.length) {
        const r = mergeByKey(settings.promptTemplates, data.promptTemplates);
        msg += `模板新增 ${r.added}、更新 ${r.updated};`;
      }
      notify('success', msg || '文件里没有可导入的内容');
    } catch (e) {
      notify('error', `导入失败:${e instanceof Error ? e.message : '文件不是合法 JSON'}`);
    }
  };
  reader.readAsText(file);
}

function onImportFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) importJson(file);
  input.value = '';
}

/* ---- 数据 ---- */
async function clearAll(): Promise<void> {
  if (!window.confirm(`删除全部 ${history.items.length} 条历史(含图片)?不可恢复。`)) return;
  await wipeHistory();
  notify('success', '历史已清空');
}

const samplers = computed(() => samplersForModel(settings.nai.model));
</script>

<template>
  <div class="tlb-set">
    <!-- 柏宝绘同步 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title"><i class="fa-solid fa-arrows-rotate" /> 从柏宝绘同步</h3>
      <p class="tlb-hint">
        读取柏宝绘当前的 NAI 配置(接入点/模型/采样器/步数/尺寸/质量词/负面词)与画师串库,
        覆写画板设置、画师串按 id 合并。之后两边独立管理,不自动跟随。上次同步:{{ syncTime(settings.lastBaibaiSyncAt) }}
      </p>
      <button class="tlb-btn tlb-btn--accent" style="margin-top: 8px" :disabled="syncing" @click="sync">
        <i class="fa-solid fa-download" /> 立即同步
      </button>
      <div class="tlb-row tlb-row--wrap" style="margin-top: 10px">
        <button class="tlb-btn tlb-btn--sm" :disabled="pushing" @click="pushArtists">
          <i :class="pushing ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-upload'" /> 回传画师串到柏宝绘
        </button>
        <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="openArtistMgr">
          <i class="fa-solid fa-external-link" /> 打开柏宝绘画师串管理器
        </button>
      </div>
      <p class="tlb-hint" style="margin-top: 6px">回传是手动决定,不自动执行;直写后需刷新页面才能在柏宝绘界面看到(实验性)。</p>
    </section>

    <!-- 接入点 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title"><i class="fa-solid fa-server" /> NAI 接入点</h3>
      <label v-for="ep in settings.nai.endpoints" :key="ep.id" class="tlb-ep" :class="{ 'tlb-ep--on': settings.nai.activeEndpointId === ep.id }">
        <input v-model="settings.nai.activeEndpointId" class="tlb-checkbox" type="radio" name="tlb-ep" :value="ep.id" />
        <span class="tlb-ep__name">{{ ep.name }}</span>
        <span class="tlb-ep__url">{{ ep.url }}</span>
        <input v-if="!isOfficial(ep.id)" v-model="ep.key" class="tlb-input tlb-ep__key" type="password" placeholder="API Key" />
        <input v-else v-model="ep.key" class="tlb-input tlb-ep__key" type="password" placeholder="API Key(官方)" />
        <button v-if="!isOfficial(ep.id)" class="tlb-btn tlb-btn--danger tlb-btn--sm" title="删除" @click="removeEndpoint(ep.id)">
          <i class="fa-solid fa-trash-can" />
        </button>
      </label>
      <div class="tlb-row tlb-row--wrap" style="margin-top: 8px">
        <input v-model="epName" class="tlb-input tlb-set__w120" placeholder="名称" />
        <input v-model="epUrl" class="tlb-input tlb-grow" placeholder="接口地址,如 https://image.novelai.net 或第三方站" />
        <input v-model="epKey" class="tlb-input tlb-set__w140" type="password" placeholder="API Key" />
        <button class="tlb-btn tlb-btn--sm" @click="addEndpoint">添加</button>
      </div>
      <div class="tlb-row" style="margin-top: 8px">
        <button class="tlb-btn tlb-btn--sm" :disabled="testing" @click="test">
          <i :class="testing ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-plug'" /> 测试连接
        </button>
        <span v-if="testMsg" class="tlb-hint">{{ testMsg }}</span>
      </div>
    </section>

    <!-- 生图参数 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title"><i class="fa-solid fa-sliders" /> 生图参数</h3>
      <div class="tlb-row tlb-row--wrap">
        <div class="tlb-grow tlb-set__min160">
          <label class="tlb-label">模型</label>
          <select v-model="settings.nai.model" class="tlb-select">
            <option v-for="m in NAI_MODELS" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </div>
        <div class="tlb-grow tlb-set__min160">
          <label class="tlb-label">采样器</label>
          <select v-model="settings.nai.sampler" class="tlb-select">
            <option v-for="s in samplers" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </div>
        <div class="tlb-set__w90">
          <label class="tlb-label">步数</label>
          <input v-model.number="settings.nai.steps" class="tlb-input" type="number" min="1" max="50" />
        </div>
        <div class="tlb-set__w90">
          <label class="tlb-label">CFG</label>
          <input v-model.number="settings.nai.scale" class="tlb-input" type="number" min="0" max="10" step="0.1" />
        </div>
        <div class="tlb-set__w90">
          <label class="tlb-label">CFG 残差</label>
          <input v-model.number="settings.nai.cfgRescale" class="tlb-input" type="number" min="0" max="1" step="0.05" />
        </div>
        <div class="tlb-grow tlb-set__min160">
          <label class="tlb-label">噪声表</label>
          <select v-model="settings.nai.noiseSchedule" class="tlb-select">
            <option v-for="s in NAI_NOISE_SCHEDULES" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </div>
      </div>
      <div class="tlb-row tlb-row--wrap" style="margin-top: 8px">
        <div class="tlb-set__w140">
          <label class="tlb-label">竖屏尺寸</label>
          <input v-model="settings.nai.portraitSize" class="tlb-input" placeholder="832×1216" />
        </div>
        <div class="tlb-set__w140">
          <label class="tlb-label">横屏尺寸</label>
          <input v-model="settings.nai.landscapeSize" class="tlb-input" placeholder="1216×832" />
        </div>
        <label class="tlb-row tlb-set__chk">
          <input v-model="settings.nai.varietyBoost" class="tlb-checkbox" type="checkbox" />
          Variety Boost
        </label>
        <div class="tlb-set__w140">
          <label class="tlb-label">默认种子(0=随机)</label>
          <input v-model.number="settings.nai.seed" class="tlb-input" type="number" min="0" />
        </div>
      </div>
    </section>

    <!-- 质量词/负面词覆写 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title"><i class="fa-solid fa-tag" /> 质量词 / 负面词覆写</h3>
      <p class="tlb-hint">回落链:画师串绑定值 → 这里的覆写 → 官方默认。留空即用官方默认。</p>
      <div style="margin-top: 8px">
        <label class="tlb-label">
          质量词覆写
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="resetQuality">恢复官方默认</button>
        </label>
        <textarea v-model="settings.nai.qualityTags" class="tlb-textarea" rows="2" :placeholder="qualityDefault" />
      </div>
      <div style="margin-top: 8px">
        <label class="tlb-label">
          负面词覆写
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" @click="resetUndesired">恢复官方默认</button>
        </label>
        <textarea v-model="settings.nai.undesiredContent" class="tlb-textarea" rows="3" :placeholder="undesiredDefault" />
      </div>

      <div class="tlb-row tlb-row--wrap" style="margin-top: 10px">
        <label class="tlb-row tlb-set__chk">
          <input v-model="settings.artistFirst" class="tlb-checkbox" type="checkbox" />
          画师串在前
        </label>
        <label class="tlb-row tlb-set__chk">
          <input v-model="settings.qualityLast" class="tlb-checkbox" type="checkbox" />
          质量词在后
        </label>
      </div>
      <p class="tlb-hint">拼接次序:[{{ settings.artistFirst ? '画师串, ' : '' }}提示词{{ settings.qualityLast ? ', 质量词' : '' }}]</p>
    </section>

    <!-- 画师串库 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title">
        <i class="fa-solid fa-palette" /> 画师串库({{ settings.artistPresets.length }})
        <span class="tlb-grow" />
        <button class="tlb-btn tlb-btn--sm" @click="artistStore.add() && (editingId = settings.artistPresets[settings.artistPresets.length - 1].id)">
          <i class="fa-solid fa-plus" /> 新建
        </button>
      </h3>
      <p v-if="!settings.artistPresets.length" class="tlb-hint">还没有画师串。从柏宝绘同步,或点「新建」。</p>
      <div v-for="a in settings.artistPresets" :key="a.id" class="tlb-artist" :class="{ 'tlb-artist--on': settings.activeArtistId === a.id }">
        <div class="tlb-row">
          <input v-model="settings.activeArtistId" class="tlb-checkbox" type="radio" name="tlb-artist" :value="a.id" :title="a.name" />
          <span class="tlb-artist__name" :title="a.prompt">{{ a.name }}</span>
          <span class="tlb-grow" />
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" :title="editingId === a.id ? '收起' : '编辑'" @click="edit(a.id)">
            <i :class="editingId === a.id ? 'fa-solid fa-chevron-up' : 'fa-solid fa-pen'" />
          </button>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="复制" @click="duplicate(a.id)">
            <i class="fa-solid fa-copy" />
          </button>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="删除" @click="artistStore.remove(a.id)">
            <i class="fa-solid fa-trash-can" />
          </button>
        </div>
        <p class="tlb-hint tlb-artist__prompt">{{ a.prompt || '(空)' }}</p>
        <div v-if="editingId === a.id" class="tlb-artist__form">
          <input v-model="a.name" class="tlb-input" placeholder="名称" />
          <textarea v-model="a.prompt" class="tlb-textarea" rows="3" placeholder="画师/画风 tag 串" />
          <input v-model="a.quality" class="tlb-input" placeholder="绑定质量词(留空 = 跟随全局)" />
          <textarea v-model="a.negative" class="tlb-textarea" rows="2" placeholder="绑定负面词(留空 = 跟随全局)" />
        </div>
      </div>
    </section>

    <!-- 提示词模板库 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title">
        <i class="fa-solid fa-bookmark" /> 提示词模板库({{ settings.promptTemplates.length }})
        <span class="tlb-grow" />
        <button class="tlb-btn tlb-btn--sm" @click="addTemplate"><i class="fa-solid fa-plus" /> 新建模板</button>
      </h3>
      <p class="tlb-hint">常用正向/负向片段,一键填入。留空内容不会被填入。</p>
      <div v-if="!settings.promptTemplates.length" class="tlb-hint" style="margin-top: 8px">还没有模板。</div>
      <div v-for="t in settings.promptTemplates" :key="t.id" class="tlb-artist">
        <div class="tlb-row">
          <span class="tlb-artist__name" :title="t.text">{{ t.name }}</span>
          <span class="tlb-grow" />
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" :title="editingTplId === t.id ? '收起' : '编辑'" @click="editingTplId = editingTplId === t.id ? null : t.id">
            <i :class="editingTplId === t.id ? 'fa-solid fa-chevron-up' : 'fa-solid fa-pen'" />
          </button>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="填入正向提示词" @click="fillTemplate(t.text, 'pos')">
            <i class="fa-solid fa-arrow-right-to-bracket" />
          </button>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="填入负面词" @click="fillTemplate(t.text, 'neg')">
            <i class="fa-solid fa-ban" />
          </button>
          <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="删除" @click="settings.promptTemplates = settings.promptTemplates.filter(x => x.id !== t.id)">
            <i class="fa-solid fa-trash-can" />
          </button>
        </div>
        <p class="tlb-hint tlb-artist__prompt">{{ t.text || '(空)' }}</p>
        <div v-if="editingTplId === t.id" class="tlb-artist__form">
          <input v-model="t.name" class="tlb-input" placeholder="名称" />
          <textarea v-model="t.text" class="tlb-textarea" rows="2" placeholder="提示词片段" />
        </div>
      </div>
    </section>

    <!-- 导入 / 导出 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title"><i class="fa-solid fa-box-archive" /> 导入 / 导出</h3>
      <p class="tlb-hint">备份画师串库与提示词模板库(JSON)。导入按 id 合并:同名覆盖、新条目追加。</p>
      <div class="tlb-row tlb-row--wrap" style="margin-top: 8px">
        <button class="tlb-btn tlb-btn--sm" @click="downloadJson"><i class="fa-solid fa-file-arrow-down" /> 导出 JSON</button>
        <label class="tlb-btn tlb-btn--sm" style="cursor: pointer">
          <i class="fa-solid fa-file-arrow-up" /> 导入 JSON
          <input type="file" accept="application/json,.json" style="display: none" @change="onImportFile" />
        </label>
      </div>
    </section>

    <!-- Bot 配置 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title"><i class="fa-solid fa-robot" /> Bot 配置(OpenAI 兼容)</h3>
      <p class="tlb-hint">「Bot」页用它对话写 tag。填 OpenAI 或任意兼容接口(如本地/代理)。</p>
      <div class="tlb-row tlb-row--wrap" style="margin-top: 8px">
        <input v-model="settings.bot.baseUrl" class="tlb-input tlb-grow" placeholder="接口地址,如 https://api.openai.com/v1" />
        <input v-model="settings.bot.key" class="tlb-input tlb-set__w140" type="password" placeholder="API Key" />
      </div>
      <div class="tlb-row" style="margin-top: 8px">
        <select v-model="settings.bot.model" class="tlb-select tlb-grow">
          <option v-if="settings.bot.model && !botModels.includes(settings.bot.model)" :value="settings.bot.model">{{ settings.bot.model }}</option>
          <option v-for="m in botModels" :key="m" :value="m">{{ m }}</option>
        </select>
        <button class="tlb-btn tlb-btn--sm" :disabled="botLoading" @click="fetchBotModels">
          <i :class="botLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-cloud-arrow-down'" /> 拉取模型
        </button>
      </div>
      <div style="margin-top: 8px">
        <label class="tlb-label">系统提示词(引导它只输出 tag)</label>
        <textarea v-model="settings.bot.systemPrompt" class="tlb-textarea" rows="4" />
      </div>
    </section>

    <!-- 外观 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title"><i class="fa-solid fa-paintbrush" /> 外观</h3>
      <div class="tlb-row tlb-row--wrap">
        <div class="tlb-set__w140">
          <label class="tlb-label">主题</label>
          <select v-model="settings.theme" class="tlb-select">
            <option value="st">跟随酒馆</option>
            <option value="day">昼 · 象牙白</option>
            <option value="night">夜 · 海军黑</option>
          </select>
        </div>
        <label class="tlb-row tlb-set__chk">
          <input v-model="settings.orbEnabled" class="tlb-checkbox" type="checkbox" />
          显示屏幕边缘浮动球
        </label>
      </div>
    </section>

    <!-- 数据 -->
    <section class="tlb-section">
      <h3 class="tlb-section-title"><i class="fa-solid fa-database" /> 数据</h3>
      <div class="tlb-row">
        <span class="tlb-hint tlb-grow">历史 {{ history.items.length }} 张,图片存本机 IndexedDB,不进柏宝绘。</span>
        <button class="tlb-btn tlb-btn--danger tlb-btn--sm" :disabled="!history.items.length" @click="clearAll">清空历史</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tlb-set {
  padding-bottom: 10px;
}

.tlb-set__w120 {
  width: 120px;
}

.tlb-set__w140 {
  width: 140px;
}

.tlb-set__w90 {
  width: 90px;
}

.tlb-set__min160 {
  min-width: 160px;
}

.tlb-set__chk {
  gap: 6px;
  font-size: 13px;
  color: var(--tlb-ink-soft);
  cursor: pointer;
  user-select: none;
  margin-top: 18px;
}

/* 接入点行 */
.tlb-ep {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  margin-bottom: 6px;
  background: var(--tlb-surface);
}

.tlb-ep--on {
  border-color: var(--tlb-accent);
}

.tlb-ep__name {
  font-weight: 600;
  flex: none;
  min-width: 90px;
}

.tlb-ep__url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--tlb-ink-muted);
  font-family: var(--tlb-font-mono);
}

.tlb-ep__key {
  width: 160px;
  flex: none;
}

/* 画师串条目 */
.tlb-artist {
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-sm);
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--tlb-surface);
}

.tlb-artist--on {
  border-color: var(--tlb-accent);
}

.tlb-artist__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tlb-artist__prompt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.tlb-artist__form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--tlb-line);
}
</style>
