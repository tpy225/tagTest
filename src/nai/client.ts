/**
 * NAI 直连客户端(浏览器 fetch,协议与官方 image.novelai.net 一致)。
 *
 * 与柏宝绘的差异:画板是单人手动测试场景,不做并发闸门,只保留两条纪律 ——
 * 1. **单请求飞行**:同时只有一个 generate 在路上,重复点击直接拒绝;
 * 2. **简单退避**:429/5xx/网络错误按 2s/4s/8s 退避(尊重 Retry-After 下界),最多 3 次重试。
 * 拼装纯净:[画师串, 提示词, 质量词] 按用户设置的次序拼接;无角色提示、无 vibe(P1)。
 */
import { unzipSync } from 'fflate';

import {
  NAI_MIN_INTERVAL_MS,
  NAI_SAMPLERS,
  VIBE_ENCODING_KEY,
  isNai5,
  naiEndpoint,
  naiRandomSeed,
  naiSamplers,
  parseResolution,
  randomUuid,
  skipCfgAboveSigma,
  vibeModelKey,
} from '@/constants';
import { activeArtistPrompt, activeEndpoint, resolveQualityTags, resolveUndesired, settings } from '@/state/settings';
import { enabledVibes } from '@/state/vibeList';
import type { TlbHistoryMeta, TlbVibe, TlbVibeEncodings } from '@/types';

export class NaiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** 对方 Retry-After 换算的毫秒数;退避下界。 */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'NaiError';
  }
}

/* ============ 提示词拼装(纯净,次序可自定义) ============ */

/** 完整正向 = [画师串?, 提示词, 质量词?] 按「拼接次序」设置拼装。artist/quality 可覆写(多画师串对比)。 */
export function buildFullPrompt(prompt: string, artist?: string, quality?: string): string {
  const a = artist ?? activeArtistPrompt();
  const q = quality ?? resolveQualityTags();
  const head = settings.artistFirst ? [a, prompt.trim()] : [prompt.trim(), a];
  const body = head.filter(Boolean).join(', ');
  return settings.qualityLast ? [body, q].filter(Boolean).join(', ') : [q, body].filter(Boolean).join(', ');
}

/* ============ 参数拼装 ============ */

export interface GenerateInput {
  /** 用户输入的正向 tag(不含画师串/质量词)。 */
  prompt: string;
  /** 显式种子;缺省用面板固定种子(0 = 随机)。 */
  seed?: number;
  /** 画师串覆写(多画师串对比用);缺省用当前选中预设。 */
  artistPrompt?: string;
  /** 质量词覆写;缺省按回落链。 */
  qualityTags?: string;
  /** 负面词覆写;缺省按回落链。 */
  negative?: string;
}

export interface GenerateResult {
  meta: TlbHistoryMeta;
  blob: Blob;
}

function buildParameters(
  prompt: string,
  seed: number,
  artist?: string,
  quality?: string,
  negative?: string,
): { params: Record<string, unknown>; size: NaiSize } {
  const nai = settings.nai;
  const { width, height } = parseResolution(nai.portraitSize || '832×1216');
  const model = nai.model;
  const sampler = isNai5(model) && !naiSamplers(model).some(s => s.value === nai.sampler) ? 'k_euler_ancestral' : nai.sampler;
  const fullPrompt = buildFullPrompt(prompt, artist, quality);
  const neg = negative ?? resolveUndesired();
  const skipCfg = skipCfgAboveSigma(width, height, model, nai.varietyBoost);

  const params: Record<string, unknown> = {
    params_version: isNai5(model) ? 4 : 3,
    width,
    height,
    scale: nai.scale,
    sampler,
    steps: nai.steps,
    n_samples: 1,
    ucPreset: 3,
    qualityToggle: true,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    legacy_uc: false,
    add_original_image: true,
    cfg_rescale: nai.cfgRescale,
    noise_schedule: nai.noiseSchedule,
    skip_cfg_above_sigma: skipCfg,
    legacy_v3_extend: false,
    stream: 'msgpack',
    seed,
    negative_prompt: neg,
    reference_strength_multiple: [],
    normalize_reference_strength_multiple: true,
    use_coords: false,
  };

  if (model.includes('nai-diffusion-3')) {
    params.sm = false;
    params.sm_dyn = false;
    params.reference_image_multiple = [];
    params.reference_information_extracted_multiple = [];
  } else {
    params.reference_image_multiple_cached = [];
    params.characterPrompts = [];
    params.v4_prompt = {
      caption: { base_caption: fullPrompt, char_captions: [] },
      use_coords: false,
      use_order: true,
    };
    params.v4_negative_prompt = {
      caption: { base_caption: neg, char_captions: [] },
      legacy_uc: false,
    };
  }

  if (sampler === 'k_euler_ancestral') {
    params.deliberate_euler_ancestral_bug = false;
    params.prefer_brownian = true;
  }
  applyVibes(params);
  return { params, size: { width, height } };
}

/**
 * 把启用的 vibe 叠加进 parameters。只在 4/4.5/V5 生效(画板模型全是这些):
 * 编码数据进 `reference_image_multiple_cached`(随机 cache key),强度并进
 * `reference_strength_multiple`。返回被跳过的 vibe 名(缺当前模型编码)。
 */
function applyVibes(params: Record<string, unknown>): string[] {
  const vibes = enabledVibes();
  if (!vibes.length) return [];
  const modelKey = vibeModelKey(settings.nai.model);
  const cached = params.reference_image_multiple_cached as { cache_secret_key: string; data: string }[];
  const strengths = params.reference_strength_multiple as number[];
  const skipped: string[] = [];
  for (const vibe of vibes) {
    const enc = vibe.encodings[modelKey];
    if (!enc?.encoding) {
      skipped.push(vibe.name);
      continue;
    }
    cached.push({ cache_secret_key: randomUuid(), data: enc.encoding });
    strengths.push(vibe.strength);
  }
  return skipped;
}

interface NaiSize {
  width: number;
  height: number;
}

/* ============ 重试与限流 ============ */

function parseRetryAfter(value: string | null): number | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const ms = Number(text) * 1000;
    return Number.isFinite(ms) ? Math.min(ms, 60_000) : null;
  }
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - Date.now()), 60_000);
}

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2000;

function isRetryable(error: unknown): boolean {
  if ((error as { name?: string } | null)?.name === 'AbortError') return false;
  const err = error as { status?: number };
  if (typeof err?.status === 'number') {
    const s = err.status;
    return s === 408 || s === 429 || (s >= 500 && s !== 501);
  }
  return error instanceof TypeError; // 网络级失败(断网/CORS/拒连)
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('已取消', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('已取消', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/* ============ HTTP 错误 ============ */

async function httpError(resp: Response, label: string): Promise<NaiError> {
  const text = (await resp.text().catch(() => '')).trim();
  let detail = text;
  try {
    const json = JSON.parse(text) as { message?: unknown };
    if (typeof json?.message === 'string') detail = json.message;
  } catch {
    /* 非 JSON 错误体直接用原文 */
  }
  const retryAfterMs = parseRetryAfter(resp.headers.get('Retry-After'));
  switch (resp.status) {
    case 400:
      return new NaiError(`${label}:请求校验失败:${detail.slice(0, 300)}`, resp.status, retryAfterMs);
    case 401:
      return new NaiError(`${label}:API Key 错误或无效`, resp.status, retryAfterMs);
    case 402:
      return new NaiError(`${label}:需要有效订阅(402)`, resp.status, retryAfterMs);
    case 429:
      return new NaiError(`${label}:请求过于频繁(429)`, resp.status, retryAfterMs);
    default:
      return new NaiError(`${label} (${resp.status}):${detail.slice(0, 300)}`, resp.status, retryAfterMs);
  }
}

/* ============ 解包 ============ */

function unzipNaiImage(buffer: ArrayBuffer): { blob: Blob; mime: string; filename: string } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new NaiError('响应不是有效的 zip 包(第三方站可能返回了其他格式)');
  }
  const name = Object.keys(files).find(n => /\.(png|jpe?g|webp)$/i.test(n)) ?? Object.keys(files)[0];
  if (!name) throw new NaiError('zip 包内没有图片文件');
  const ext = name.split('.').pop()?.toLowerCase() || 'png';
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  // slice() 复制出独立 ArrayBuffer(类型上也满足 BlobPart)
  return { blob: new Blob([files[name].slice()], { type: mime }), mime, filename: name };
}

/* ============ 生图入口 ============ */

function newId(): string {
  return `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let inflight: Promise<GenerateResult> | null = null;
let lastStartAt = 0;

/** 是否有请求在路上(UI 据此禁用生成按钮)。 */
export function isGenerating(): boolean {
  return inflight !== null;
}

/**
 * 生图(直连)。单请求飞行:已有请求在路上时抛错。
 * 成功返回可直接入库的 {meta, blob};调用方负责写入历史。
 */
export async function generateNaiImage(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
  if (inflight) throw new NaiError('已有生成任务进行中,请等它完成');
  if (!input.prompt.trim()) throw new NaiError('正向提示词不能为空');
  const task = doGenerate(input, signal);
  inflight = task;
  try {
    return await task;
  } finally {
    inflight = null;
  }
}

async function doGenerate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
  const ep = activeEndpoint();
  if (!ep.key.trim()) throw new NaiError('请先在设置里填写 NAI API Key(或从柏宝绘同步)');

  const seed = input.seed ?? (settings.nai.seed > 0 ? settings.nai.seed : naiRandomSeed());
  const artist = input.artistPrompt ?? activeArtistPrompt();
  const quality = input.qualityTags ?? resolveQualityTags();
  const negative = input.negative ?? resolveUndesired();
  const { params, size } = buildParameters(input.prompt, seed, artist, quality, negative);
  const fullPrompt = buildFullPrompt(input.prompt, artist, quality);
  const body = {
    input: fullPrompt,
    model: settings.nai.model,
    action: 'generate',
    parameters: params,
    use_new_shared_trial: true,
  };

  for (let attempt = 0; ; attempt++) {
    // 最小间隔:上一发刚出去就重试会白吃 429
    const since = Date.now() - lastStartAt;
    if (lastStartAt > 0 && since < NAI_MIN_INTERVAL_MS) {
      await abortableDelay(NAI_MIN_INTERVAL_MS - since, signal);
    }
    try {
      lastStartAt = Date.now();
      const resp = await fetch(naiEndpoint(ep.url, 'generate-image'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key.trim()}` },
        body: JSON.stringify(body),
        signal,
      });
      if (!resp.ok) throw await httpError(resp, 'NAI 生图失败');
      const { blob, mime, filename } = unzipNaiImage(await resp.arrayBuffer());
      const meta: TlbHistoryMeta = {
        id: newId(),
        prompt: fullPrompt,
        rawPrompt: input.prompt.trim(),
        negative,
        artistPrompt: artist,
        qualityTags: quality,
        model: settings.nai.model,
        sampler: params.sampler as string,
        steps: settings.nai.steps,
        scale: settings.nai.scale,
        cfgRescale: settings.nai.cfgRescale,
        noiseSchedule: settings.nai.noiseSchedule,
        seed,
        width: size.width,
        height: size.height,
        mime,
        createdAt: Date.now(),
        favorite: false,
      };
      void filename;
      return { meta, blob };
    } catch (error) {
      if (attempt >= MAX_RETRIES || !isRetryable(error)) throw error;
      const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs ?? null;
      const backoff = Math.min(BACKOFF_BASE_MS * 2 ** attempt, 60_000);
      const waitMs = Math.max(Math.round(backoff * (0.5 + 0.5 * Math.random())), retryAfterMs ?? 0);
      console.warn(`[TagLab] NAI 请求失败,${Math.round(waitMs / 1000)}s 后重试(第 ${attempt + 1}/${MAX_RETRIES} 次):`, error);
      await abortableDelay(waitMs, signal);
    }
  }
}

/* ============ 连接测试 ============ */

export async function testConnection(signal?: AbortSignal): Promise<string> {
  const ep = activeEndpoint();
  if (!ep.key.trim()) throw new NaiError('请先填写 API Key');
  const resp = await fetch(naiEndpoint(ep.url, 'user/subscription'), {
    headers: { Authorization: `Bearer ${ep.key.trim()}` },
    signal,
  });
  if (resp.status === 404) return '地址可达,但无订阅接口(第三方站);请以实际生图验证';
  if (!resp.ok) throw await httpError(resp, '连接 NAI 失败');
  const data = (await resp.json().catch(() => null)) as {
    tier?: number;
    active?: boolean;
    subscription?: { tier?: number; active?: boolean };
  } | null;
  const tier = data?.subscription?.tier ?? data?.tier;
  const active = data?.subscription?.active ?? data?.active;
  const tierName = ['Free', 'Tablet', 'Scroll', 'Opus'][Number(tier)] ?? `Tier ${tier}`;
  return `连接正常:${tierName}${active === false ? '(订阅未激活)' : ''}`;
}

/* ============ 供设置页用的采样器表(带 V5 过滤) ============ */

export function samplersForModel(model: string): { value: string; label: string }[] {
  return naiSamplers(model) ?? NAI_SAMPLERS;
}

/* ============ Vibe Transfer(直连模式下生效) ============ */

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 调 /ai/encode-vibe 把参考图编码成 vibe 数据(base64)。
 * 返回的 base64 对应「当前模型」分组,由调用方挂进 vibe 的 encodings。
 */
export async function encodeVibeImage(imageBase64: string, signal?: AbortSignal): Promise<string> {
  const ep = activeEndpoint();
  if (!ep.key.trim()) throw new NaiError('请先填写 NAI API Key');
  const resp = await fetch(naiEndpoint(ep.url, 'encode-vibe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key.trim()}` },
    body: JSON.stringify({ image: imageBase64, information_extracted: 1, model: settings.nai.model }),
    signal,
  });
  if (!resp.ok) throw await httpError(resp, 'vibe 编码失败');
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length < 100) throw new NaiError('vibe 编码数据异常(响应过短),接口可能返回了错误响应');
  return uint8ToBase64(bytes);
}

export interface ImportedVibe {
  name: string;
  image: string;
  thumbnail: string;
  encodings: TlbVibeEncodings;
  strength: number;
}

/** 解析官方 .naiv4vibe 文件文本(JSON),返回不含 id 的 vibe 条目。 */
export function parseNaiv4vibe(text: string): ImportedVibe {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new NaiError('不是有效的 .naiv4vibe 文件(JSON 解析失败)');
  }
  if (json.identifier !== 'novelai-vibe-transfer') {
    throw new NaiError('不是 NovelAI vibe 文件(缺少 novelai-vibe-transfer 标识)');
  }
  const encodings: TlbVibeEncodings = {};
  const groups = (json.encodings ?? {}) as Record<string, Record<string, unknown>>;
  for (const [modelKey, group] of Object.entries(groups)) {
    const first = Object.values(group ?? {})[0] as { encoding?: unknown; params?: { information_extracted?: unknown } } | undefined;
    if (typeof first?.encoding === 'string' && first.encoding) {
      encodings[modelKey] = {
        encoding: first.encoding,
        infoExtracted:
          typeof first.params?.information_extracted === 'number' ? first.params.information_extracted : 1,
      };
    }
  }
  if (!Object.keys(encodings).length) throw new NaiError('vibe 文件里没有可用的编码数据');
  return {
    name: typeof json.name === 'string' && json.name ? json.name : '导入的 Vibe',
    image: typeof json.image === 'string' ? json.image : '',
    thumbnail: typeof json.thumbnail === 'string' && json.thumbnail.startsWith('data:') ? json.thumbnail : '',
    encodings,
    strength: clampStrength(json.importInfo),
  };
}

function clampStrength(importInfo: unknown): number {
  const n = (importInfo as { strength?: unknown } | null)?.strength;
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0.5;
  return Math.min(1, Math.max(0, v));
}

/** 导出某条 vibe 为官方兼容的 .naiv4vibe JSON(带全部已编码模型)。 */
export function buildNaiv4vibe(vibe: TlbVibe): string {
  const groups: Record<string, Record<string, unknown>> = {};
  for (const [modelKey, enc] of Object.entries(vibe.encodings)) {
    groups[modelKey] = {
      [VIBE_ENCODING_KEY]: {
        encoding: enc.encoding,
        params: { information_extracted: enc.infoExtracted },
      },
    };
  }
  const id = vibe.image ? vibe.id : randomUuid();
  return JSON.stringify({
    identifier: 'novelai-vibe-transfer',
    version: 1,
    type: 'image',
    image: vibe.image,
    id,
    encodings: groups,
    name: vibe.name,
    thumbnail: vibe.thumbnail,
    createdAt: vibe.createdAt,
    importInfo: {
      model: Object.keys(vibe.encodings)[0] ?? '',
      information_extracted: 1,
      strength: vibe.strength,
    },
  });
}
