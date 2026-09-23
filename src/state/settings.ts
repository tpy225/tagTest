/**
 * 设置存储:localStorage 自管的响应式单例。
 *
 * 与柏宝绘的分工:这里的数据**只**属于画板 —— 柏宝绘不知道它,它也不写
 * extension_settings(同步是单向读)。启动时 hydrate 一次,之后任意字段变更
 * 即时落盘(浅 watch + JSON 全量序列化,量级小到不值得做增量)。
 */
import { reactive, watch } from 'vue';

import { NAI_OFFICIAL_URL, OFFICIAL_ENDPOINT_ID, naiDefaultQualityTags, naiDefaultUndesired } from '@/constants';
import type { TlbArtistPreset, TlbNaiEndpoint, TlbSettings } from '@/types';

const STORAGE_KEY = 'tlb_settings';

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function officialEndpoint(): TlbNaiEndpoint {
  return { id: OFFICIAL_ENDPOINT_ID, name: 'NovelAI 官方', url: NAI_OFFICIAL_URL, key: '' };
}

export function defaultSettings(): TlbSettings {
  return {
    version: 1,
    theme: 'st',
    nai: {
      endpoints: [officialEndpoint()],
      activeEndpointId: OFFICIAL_ENDPOINT_ID,
      model: 'nai-diffusion-4-5-full',
      sampler: 'k_euler_ancestral',
      steps: 23,
      scale: 5,
      cfgRescale: 0,
      noiseSchedule: 'karras',
      qualityTags: '',
      undesiredContent: '',
      varietyBoost: false,
      portraitSize: '832×1216',
      landscapeSize: '1216×832',
      seed: 0,
    },
    artistPresets: [],
    promptTemplates: [],
    activeArtistId: '',
    artistFirst: true,
    qualityLast: true,
    orbEnabled: true,
    panelPos: null,
    lastBaibaiSyncAt: 0,
    bot: {
      baseUrl: 'https://api.openai.com/v1',
      key: '',
      model: 'gpt-4o-mini',
      systemPrompt:
        '你是 Tag 实验室的提示词助手。用户会用自然语言描述想要的画面,你用 NovelAI / Stable Diffusion 的标签(tag)风格回答。要求:只输出英文 tag,用英文逗号分隔;不要写句子、不要解释、不要 Markdown 代码块、不要序号。',
    },
  };
}

/** 归一:补缺失字段、纠脏值(手工改 localStorage / 版本升级的兜底)。 */
function normalize(s: TlbSettings): TlbSettings {
  const d = defaultSettings();
  const out: TlbSettings = { ...d, ...s };
  out.nai = { ...d.nai, ...(s.nai ?? {}) };
  out.bot = { ...d.bot, ...(s.bot ?? {}) };
  if (!Array.isArray(out.nai.endpoints) || out.nai.endpoints.length === 0) {
    out.nai.endpoints = [officialEndpoint()];
  }
  // 官方接入点恒在、url 恒正(与柏宝绘同口径)
  if (!out.nai.endpoints.some(e => e.id === OFFICIAL_ENDPOINT_ID)) {
    out.nai.endpoints.unshift(officialEndpoint());
  } else {
    const off = out.nai.endpoints.find(e => e.id === OFFICIAL_ENDPOINT_ID)!;
    off.url = NAI_OFFICIAL_URL;
  }
  if (!out.nai.endpoints.some(e => e.id === out.nai.activeEndpointId)) {
    out.nai.activeEndpointId = out.nai.endpoints[0].id;
  }
  if (!NAI_MODELS_OK.has(out.nai.model)) out.nai.model = d.nai.model;
  if (!out.artistPresets) out.artistPresets = [];
  if (!out.artistPresets.some(a => a.id === out.activeArtistId)) out.activeArtistId = '';
  if (!Array.isArray(out.promptTemplates)) out.promptTemplates = [];
  return out;
}

const NAI_MODELS_OK = new Set([
  'nai-diffusion-5-full',
  'nai-diffusion-5-curated',
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
]);

function load(): TlbSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    return normalize({ ...defaultSettings(), ...(JSON.parse(raw) as Partial<TlbSettings>) });
  } catch (e) {
    console.warn('[TagLab] 设置读取失败,使用默认值', e);
    return defaultSettings();
  }
}

/** 全局响应式设置单例(全插件共用这一份)。 */
export const settings = reactive<TlbSettings>(load());

let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  settings,
  () => {
    // 防抖落盘:滑块拖动时会高频触发
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch (e) {
        console.error('[TagLab] 设置保存失败', e);
      }
    }, 150);
  },
  { deep: true },
);

/** 当前生效的接入点(恒非空:normalize 兜底回落第一条)。 */
export function activeEndpoint(): TlbNaiEndpoint {
  return settings.nai.endpoints.find(e => e.id === settings.nai.activeEndpointId) ?? settings.nai.endpoints[0];
}

/** 当前选中的画师串;未选/悬空 → null。 */
export function activeArtistPreset() {
  if (!settings.activeArtistId) return null;
  return settings.artistPresets.find(a => a.id === settings.activeArtistId) ?? null;
}

/** 质量词三级回落:配方绑定 → 全局覆写 → 模型官方默认。 */
export function resolveQualityTags(): string {
  return activeArtistPreset()?.quality.trim() || settings.nai.qualityTags.trim() || naiDefaultQualityTags(settings.nai.model);
}

/** 负面词三级回落:配方绑定 → 全局覆写 → 模型官方默认。 */
export function resolveUndesired(): string {
  return activeArtistPreset()?.negative.trim() || settings.nai.undesiredContent.trim() || naiDefaultUndesired(settings.nai.model);
}

/** 当前生效画师串原文(未选/全空白 → 空串)。 */
export function activeArtistPrompt(): string {
  return activeArtistPreset()?.prompt.trim() ?? '';
}

/** 全局质量词(忽略画师串绑定):覆写 → 模型官方默认。多画师串对比用它。 */
export function globalQualityTags(): string {
  return settings.nai.qualityTags.trim() || naiDefaultQualityTags(settings.nai.model);
}

/** 全局负面词(忽略画师串绑定):覆写 → 模型官方默认。多画师串对比用它。 */
export function globalUndesired(): string {
  return settings.nai.undesiredContent.trim() || naiDefaultUndesired(settings.nai.model);
}

/** 画师串库的增删改(P0 直接操作 settings,保存自动落盘)。 */
export const artistStore = {
  add(preset?: Partial<TlbArtistPreset>): TlbArtistPreset {
    const item: TlbArtistPreset = {
      id: newId('art'),
      name: preset?.name ?? '新画师串',
      prompt: preset?.prompt ?? '',
      quality: preset?.quality ?? '',
      negative: preset?.negative ?? '',
    };
    settings.artistPresets.push(item);
    return item;
  },
  duplicate(id: string): TlbArtistPreset | null {
    const src = settings.artistPresets.find(a => a.id === id);
    if (!src) return null;
    const copy: TlbArtistPreset = { ...src, id: newId('art'), name: `${src.name} 副本` };
    settings.artistPresets.push(copy);
    return copy;
  },
  remove(id: string): void {
    const idx = settings.artistPresets.findIndex(a => a.id === id);
    if (idx >= 0) settings.artistPresets.splice(idx, 1);
    if (settings.activeArtistId === id) settings.activeArtistId = '';
  },
};
