/**
 * 从柏宝绘手动同步配置。
 *
 * 单向只读:点击同步按钮时读一次 `extensionSettings['baibai_image']`,把 NAI 配置
 * 覆写进画板、画师串按 id 合并(同 id 更新、新 id 追加、画板自建条目保留)。
 * 之后两边独立演化,不自动跟随 —— 柏宝绘那边保存时全量覆盖自己的键,画板不碰它。
 */
import { OFFICIAL_ENDPOINT_ID } from '@/constants';
import { newId, officialEndpoint, settings } from '@/state/settings';
import type { TlbNaiEndpoint } from '@/types';

interface BaibaiEndpoint {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  key?: unknown;
}

interface BaibaiArtist {
  id?: unknown;
  name?: unknown;
  prompt?: unknown;
  quality?: unknown;
  negative?: unknown;
  previewPath?: unknown;
}

/** 柏宝绘 NaiSettings 中画板关心的字段(宽松类型:跨插件读值不做类型断言信任)。 */
interface BaibaiNaiShape {
  endpoints?: BaibaiEndpoint[];
  activeEndpointId?: unknown;
  model?: unknown;
  sampler?: unknown;
  steps?: unknown;
  scale?: unknown;
  cfgRescale?: unknown;
  noiseSchedule?: unknown;
  qualityTags?: unknown;
  undesiredContent?: unknown;
  varietyBoost?: unknown;
  portraitSize?: unknown;
  landscapeSize?: unknown;
  seed?: unknown;
  artistPresets?: BaibaiArtist[];
  activeArtistId?: unknown;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

export class BaibaiSyncError extends Error {}

/** 读柏宝绘的设置对象;ST 未就绪 / 未安装柏宝绘 / 数据为空时抛错。 */
function readBaibaiNai(): BaibaiNaiShape {
  const st = (window as unknown as { SillyTavern?: { getContext?: () => unknown } }).SillyTavern;
  const ctx = st?.getContext?.() as { extensionSettings?: Record<string, unknown> } | undefined;
  const stored = ctx?.extensionSettings?.['baibai_image'] as { nai?: BaibaiNaiShape } | undefined;
  if (!stored || typeof stored !== 'object' || !stored.nai) {
    throw new BaibaiSyncError('读不到柏宝绘的设置:请确认柏宝绘已安装并至少打开过一次');
  }
  return stored.nai;
}

export interface SyncReport {
  endpoints: number;
  artistsImported: number;
  artistsUpdated: number;
}

/**
 * 执行同步:NAI 配置整体覆写 + 画师串按 id 合并。
 * 内置官方接入点保持画板自己的 id/url 不被覆盖。
 */
export function syncFromBaibai(): SyncReport {
  const nai = readBaibaiNai();
  const report: SyncReport = { endpoints: 0, artistsImported: 0, artistsUpdated: 0 };

  /* ---- NAI 配置覆写 ---- */
  const theirs = Array.isArray(nai.endpoints) ? nai.endpoints : [];
  const mapped: TlbNaiEndpoint[] = [];
  for (const ep of theirs) {
    const url = str(ep.url);
    if (!url) continue;
    // 柏宝绘的官方条跳过 —— 用画板自己的内置官方条(id/展示名都是自己的)
    if (url.replace(/\/+$/, '') === 'https://image.novelai.net') continue;
    mapped.push({ id: newId('ep'), name: str(ep.name, '接入点'), url, key: str(ep.key) });
  }
  settings.nai.endpoints = [officialEndpoint(), ...mapped];
  report.endpoints = mapped.length;
  // 活动接入点:按 url 对上柏宝绘当前选的那条;对不上回落官方
  const activeUrl = str(theirs.find(e => e.id === nai.activeEndpointId)?.url).replace(/\/+$/, '');
  const match = settings.nai.endpoints.find(e => e.url.replace(/\/+$/, '') === activeUrl);
  settings.nai.activeEndpointId = match?.id ?? OFFICIAL_ENDPOINT_ID;

  settings.nai.model = str(nai.model, settings.nai.model);
  settings.nai.sampler = str(nai.sampler, settings.nai.sampler);
  settings.nai.steps = num(nai.steps, settings.nai.steps);
  settings.nai.scale = num(nai.scale, settings.nai.scale);
  settings.nai.cfgRescale = num(nai.cfgRescale, settings.nai.cfgRescale);
  settings.nai.noiseSchedule = str(nai.noiseSchedule, settings.nai.noiseSchedule);
  settings.nai.qualityTags = str(nai.qualityTags);
  settings.nai.undesiredContent = str(nai.undesiredContent);
  settings.nai.varietyBoost = bool(nai.varietyBoost);
  settings.nai.portraitSize = str(nai.portraitSize, settings.nai.portraitSize);
  settings.nai.landscapeSize = str(nai.landscapeSize, settings.nai.landscapeSize);
  settings.nai.seed = num(nai.seed, 0);

  /* ---- 画师串合并(按 id;柏宝绘的 art_* / bi_* id 原样保留) ---- */
  const theirsArtists = Array.isArray(nai.artistPresets) ? nai.artistPresets : [];
  for (const a of theirsArtists) {
    const id = str(a.id);
    if (!id) continue;
    const item = {
      id,
      name: str(a.name, '未命名'),
      prompt: str(a.prompt),
      quality: str(a.quality),
      negative: str(a.negative),
    };
    const exist = settings.artistPresets.find(x => x.id === id);
    if (exist) {
      Object.assign(exist, item);
      report.artistsUpdated++;
    } else {
      settings.artistPresets.push(item);
      report.artistsImported++;
    }
  }
  // 当前选中:柏宝绘选了库内条目且已同步进来才跟随,否则保持画板现状(含「不使用」)
  const baibaiActive = str(nai.activeArtistId);
  if (baibaiActive && settings.artistPresets.some(x => x.id === baibaiActive)) {
    settings.activeArtistId = baibaiActive;
  }
  settings.lastBaibaiSyncAt = Date.now();
  return report;
}

/* ============ 反向联动:回传画师串 / 读角色库 / 打开管理器 ============ */

/** 柏宝绘公开接口的宽松形状(只用到的成员)。 */
interface BaibaiPublicApi {
  getCharacters?: () => { characters?: BaibaiCharacter[] };
  openArtistManager?: () => void;
}

interface BaibaiCharacter {
  name?: unknown;
  tag?: unknown;
}

function publicApi(): BaibaiPublicApi {
  return (window as unknown as { STBaiBaiImage?: BaibaiPublicApi }).STBaiBaiImage ?? {};
}

interface BaibaiStored {
  nai?: { artistPresets?: unknown };
}

function readBaibaiStored(): BaibaiStored {
  const st = (window as unknown as { SillyTavern?: { getContext?: () => unknown } }).SillyTavern;
  const ctx = st?.getContext?.() as { extensionSettings?: Record<string, unknown> } | undefined;
  const stored = ctx?.extensionSettings?.['baibai_image'] as BaibaiStored | undefined;
  if (!stored || typeof stored !== 'object' || !stored.nai || typeof stored.nai !== 'object') {
    throw new BaibaiSyncError('读不到柏宝绘的设置:请确认柏宝绘已安装并至少打开过一次');
  }
  return stored;
}

export interface PushReport {
  /** 画板写进柏宝绘的画师串条数。 */
  written: number;
  /** 写完后柏宝绘的画师串库总数(合并后)。 */
  total: number;
}

/**
 * 回传画师串到柏宝绘(手动触发)。合并规则:以画板为准,同 id 覆盖字段(保留柏宝绘的
 * previewPath)、新 id 追加、柏宝绘独有条目保留。
 * ⚠ 柏宝绘只在启动 hydrate 一次、保存时全量覆盖;直写后需**刷新页面**才在柏宝绘界面可见,
 *   且柏宝绘接下来的保存会覆盖本次直写(已知竞态,属实验性能力)。
 */
export function pushArtistsToBaibai(): PushReport {
  const stored = readBaibaiStored();
  const theirs = Array.isArray(stored.nai!.artistPresets) ? (stored.nai!.artistPresets as BaibaiArtist[]) : [];
  const map = new Map<string, BaibaiArtist>();
  for (const a of theirs) {
    const id = str(a.id);
    if (id) map.set(id, a);
  }
  for (const p of settings.artistPresets) {
    const prev = map.get(p.id);
    map.set(p.id, {
      id: p.id,
      name: p.name,
      prompt: p.prompt,
      quality: p.quality,
      negative: p.negative,
      previewPath: typeof prev?.previewPath === 'string' ? prev.previewPath : undefined,
    });
  }
  stored.nai!.artistPresets = [...map.values()];
  return { written: settings.artistPresets.length, total: map.size };
}

/** 读柏宝绘角色库(含可直接用于生图的 tag)。 */
export function getBaibaiCharacters(): { name: string; tag: string }[] {
  const api = publicApi();
  if (typeof api.getCharacters !== 'function') {
    throw new BaibaiSyncError('柏宝绘未安装或版本过旧,无法读取角色库');
  }
  const list = api.getCharacters()?.characters;
  if (!Array.isArray(list)) return [];
  return list.flatMap(c => {
    const name = str(c.name);
    const tag = str(c.tag);
    return name && tag ? [{ name, tag }] : [];
  });
}

/** 打开柏宝绘的画师串管理器(NAI 面板内)。 */
export function openBaibaiArtistManager(): void {
  const api = publicApi();
  if (typeof api.openArtistManager !== 'function') {
    throw new BaibaiSyncError('柏宝绘未安装或版本过旧,无法打开画师串管理器');
  }
  api.openArtistManager();
}
