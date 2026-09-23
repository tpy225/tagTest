<script setup lang="ts">
/**
 * 可拖动浮动面板:窗口主体 + 标题栏(拖动手柄) + 内容区 + 底栏 tab。
 * 位置存 settings.panelPos,越界自动拉回。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { settings } from '@/state/settings';
import { closePanel, ui, type TlbTab } from '@/state/ui';

const PANEL_W = 720;
const PANEL_H_RATIO = 0.84;
const version = __TLB_VERSION__;

const pos = ref<{ x: number; y: number }>({ x: 0, y: 0 });
const size = ref({ w: PANEL_W, h: 600 });

const style = computed(() => ({
  left: `${pos.value.x}px`,
  top: `${pos.value.y}px`,
  width: `${size.value.w}px`,
  height: `${size.value.h}px`,
}));

const TABS: { key: TlbTab; label: string; icon: string }[] = [
  { key: 'gen', label: '生成', icon: 'fa-solid fa-wand-magic-sparkles' },
  { key: 'compare', label: '对比', icon: 'fa-solid fa-layer-group' },
  { key: 'bot', label: 'Bot', icon: 'fa-solid fa-robot' },
  { key: 'gallery', label: '画廊', icon: 'fa-solid fa-images' },
  { key: 'favorites', label: '收藏', icon: 'fa-solid fa-star' },
  { key: 'settings', label: '设置', icon: 'fa-solid fa-gear' },
];

function clampPos(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - size.value.w);
  const maxY = Math.max(0, window.innerHeight - 48);
  return { x: Math.min(Math.max(x, 0), maxX), y: Math.min(Math.max(y, 0), maxY) };
}

function layout(): void {
  size.value = { w: Math.min(PANEL_W, window.innerWidth - 16), h: Math.round(window.innerHeight * PANEL_H_RATIO) };
  pos.value = settings.panelPos ? clampPos(settings.panelPos.x, settings.panelPos.y) : center();
}

function center(): { x: number; y: number } {
  return {
    x: Math.max(8, Math.round((window.innerWidth - size.value.w) / 2)),
    y: Math.max(8, Math.round((window.innerHeight - size.value.h) / 2.4)),
  };
}

onMounted(layout);
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
watch(
  () => ui.panelOpen,
  open => {
    if (open) layout();
  },
);

/** Esc 关闭窗口。 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.panelOpen) closePanel();
}

/* ---- 拖动(标题栏 pointer 事件) ---- */
let dragStart: { px: number; py: number; x: number; y: number } | null = null;

function onDragDown(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest('button')) return;
  dragStart = { px: e.clientX, py: e.clientY, x: pos.value.x, y: pos.value.y };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onDragMove(e: PointerEvent): void {
  if (!dragStart) return;
  pos.value = clampPos(dragStart.x + (e.clientX - dragStart.px), dragStart.y + (e.clientY - dragStart.py));
}

function onDragUp(): void {
  if (!dragStart) return;
  dragStart = null;
  settings.panelPos = { ...pos.value };
}
</script>

<template>
  <div class="tlb-panel" :style="style">
    <div class="tlb-panel__head" @pointerdown="onDragDown" @pointermove="onDragMove" @pointerup="onDragUp" @pointercancel="onDragUp">
      <i class="fa-solid fa-flask" />
      <span class="tlb-panel__title">Tag 实验室</span>
      <span class="tlb-hint tlb-panel__ver">v{{ version }}</span>
      <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" title="关闭 (Esc)" @click.stop="closePanel()">
        <i class="fa-solid fa-xmark" />
      </button>
    </div>

    <div class="tlb-panel__body tlb-scroll">
      <slot />
    </div>

    <div class="tlb-panel__tabs">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="tlb-tab"
        :class="{ 'tlb-tab--on': ui.tab === tab.key }"
        @click.stop="ui.tab = tab.key"
      >
        <i :class="tab.icon" />
        <span>{{ tab.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tlb-panel {
  position: fixed;
  z-index: 10010;
  display: flex;
  flex-direction: column;
  background: var(--tlb-bg);
  border: 1px solid var(--tlb-line);
  border-radius: var(--tlb-radius-win);
  box-shadow: var(--tlb-shadow);
  overflow: hidden;
  pointer-events: auto;
}

.tlb-panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--tlb-surface);
  border-bottom: 1px solid var(--tlb-line);
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.tlb-panel__head:active {
  cursor: grabbing;
}

.tlb-panel__title {
  font-weight: 700;
  font-size: 14.5px;
}

.tlb-panel__ver {
  flex: 1;
}

.tlb-panel__body {
  flex: 1;
  min-height: 0;
  padding: 0 16px;
  pointer-events: auto;
}

.tlb-panel__tabs {
  display: flex;
  border-top: 1px solid var(--tlb-line);
  background: var(--tlb-surface);
}

.tlb-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 0;
  border: none;
  background: transparent;
  color: var(--tlb-ink-soft);
  font-size: 13px;
  cursor: pointer;
  transition: color var(--tlb-dur) var(--tlb-ease), background var(--tlb-dur) var(--tlb-ease);
}

.tlb-tab:hover {
  color: var(--tlb-ink);
  background: var(--tlb-surface-2);
}

.tlb-tab--on {
  color: var(--tlb-accent);
  font-weight: 700;
  box-shadow: inset 0 -2px 0 var(--tlb-accent);
}
</style>
