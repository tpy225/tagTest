/**
 * Tag 实验室 · 类型定义
 *
 * 存储分层:
 * - 设置(localStorage 'tlb_settings'):NAI 连接/参数、画师串库、Bot 配置、界面偏好,
 *   全部自管,不进 SillyTavern extension_settings,不与柏宝绘互相覆盖。
 * - 历史(IndexedDB 'st-taglab'):图片 Blob 与元数据(含收藏标记)。
 */

/** 一条画师串配方(与柏宝绘 NaiArtistPreset 同构,便于同步导入)。 */
export interface TlbArtistPreset {
  id: string;
  /** 显示名;允许重名,以 id 为键。 */
  name: string;
  /** 画师/画风 tag 串,按「拼接次序」设置与提示词拼装;空串 = 不参与拼装。 */
  prompt: string;
  /** 绑定的正面质量词;空串 = 跟随全局覆写 → 模型官方默认。 */
  quality: string;
  /** 绑定的负面提示词;空串 = 跟随全局覆写 → 模型官方默认。 */
  negative: string;
}

/** 一条提示词模板(常用正向/负向片段,一键填入)。 */
export interface TlbPromptTemplate {
  id: string;
  /** 显示名。 */
  name: string;
  /** 提示词片段(正向或负向均可,由填入目标决定)。 */
  text: string;
}

/** 单个模型的 vibe 编码(官方 .naiv4vibe 内层)。 */
export interface TlbVibeEncoding {
  /** 编码数据(base64)。 */
  encoding: string;
  /** 信息提取度(编码时提交,生成时不用)。 */
  infoExtracted: number;
}

/** 按模型 key 分组的 vibe 编码(与官方 .naiv4vibe 同构)。 */
export type TlbVibeEncodings = Record<string, TlbVibeEncoding>;

/** 一条 Vibe Transfer 条目(完整正文存 IndexedDB 'vibes' store)。 */
export interface TlbVibe {
  id: string;
  /** 显示名。 */
  name: string;
  /** 参考原图 base64(不含 data: 前缀;编码自图片时有值,供导出)。 */
  image: string;
  /** 缩略图 dataURL(可空,缺省用占位图标)。 */
  thumbnail: string;
  /** 按模型分组的编码数据。 */
  encodings: TlbVibeEncodings;
  /** 参考强度 0–1。 */
  strength: number;
  /** 生成时是否叠加。 */
  enabled: boolean;
  createdAt: number;
}

/** 一条 NAI 接入点(官方/镜像/第三方转发),只有地址与密钥。 */
export interface TlbNaiEndpoint {
  id: string;
  name: string;
  url: string;
  key: string;
}

/** Bot 配置(OpenAI 兼容接口,自配)。 */
export interface TlbBot {
  /** 接口基地址,如 https://api.openai.com/v1 或完整 /chat/completions 地址。 */
  baseUrl: string;
  key: string;
  model: string;
  /** 系统提示词,引导它只输出 tag。 */
  systemPrompt: string;
}

export type TlbTheme = 'st' | 'day' | 'night';

/** NAI 连接与出图参数(画板自管的一份,从柏宝绘手动同步而来之后独立演化)。 */
export interface TlbNai {
  endpoints: TlbNaiEndpoint[];
  activeEndpointId: string;
  model: string;
  sampler: string;
  steps: number;
  scale: number;
  cfgRescale: number;
  noiseSchedule: string;
  /** 质量词覆写;空串 = 模型官方默认。 */
  qualityTags: string;
  /** 负面词覆写;空串 = 模型官方默认。 */
  undesiredContent: string;
  varietyBoost: boolean;
  portraitSize: string;
  landscapeSize: string;
  /** 面板固定种子;0 = 每次随机。 */
  seed: number;
}

export interface TlbSettings {
  version: number;
  theme: TlbTheme;
  nai: TlbNai;
  bot: TlbBot;
  artistPresets: TlbArtistPreset[];
  /** 提示词模板库。 */
  promptTemplates: TlbPromptTemplate[];
  /** 当前画师串 id;空串 = 不使用。 */
  activeArtistId: string;
  /** 拼接次序:画师串是否放在提示词前(默认是)。 */
  artistFirst: boolean;
  /** 拼接次序:质量词是否放在提示词后(默认是)。 */
  qualityLast: boolean;
  /** 屏幕边缘浮动球开关。 */
  orbEnabled: boolean;
  /** 浮动面板上次位置(px);null = 默认居中。 */
  panelPos: { x: number; y: number } | null;
  /** 最近一次从柏宝绘同步的时间戳;0 = 从未同步。 */
  lastBaibaiSyncAt: number;
}

/** 一条历史记录元数据(IndexedDB 'meta' store;Blob 在 'blobs' store)。 */
export interface TlbHistoryMeta {
  id: string;
  /** 拼装后的完整正向提示词(用于展示/复制)。 */
  prompt: string;
  /** 用户原始输入的正向 tag(不含画师串/质量词;滑动回填用它,避免二次拼装)。 */
  rawPrompt: string;
  negative: string;
  /** 当时生效的画师串原文(空串 = 未使用)。 */
  artistPrompt: string;
  /** 当时生效的质量词。 */
  qualityTags: string;
  model: string;
  sampler: string;
  steps: number;
  scale: number;
  cfgRescale: number;
  noiseSchedule: string;
  /** 实际使用的种子(生成后回写,便于复现)。 */
  seed: number;
  width: number;
  height: number;
  mime: string;
  createdAt: number;
  /** 是否收藏;画廊「只看收藏」据此过滤。 */
  favorite: boolean;
  /** 小缩略图 dataURL(画廊网格用;缺省为空,旧记录回落读全图)。 */
  thumb?: string;
}
