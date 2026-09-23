<script setup lang="ts">
/**
 * 屏幕边缘浮动球:点击开面板,拖动换位置(右缘吸附,垂直自由)。
 * 拖/点区分:抬起时位移 < 6px 视为点击。
 */
import { onMounted, ref } from 'vue';

import { togglePanel } from '@/state/ui';

const pos = ref({ x: -1, y: 120 }); // x<0 表示未初始化(停靠右缘)
const el = ref<HTMLElement | null>(null);

let drag: { px: number; py: number; x: number; y: number; moved: boolean } | null = null;

function clampY(y: number): number {
  return Math.min(Math.max(y, 8), window.innerHeight - 56);
}

function onDown(e: PointerEvent): void {
  drag = { px: e.clientX, py: e.clientY, x: currentX(), y: pos.value.y, moved: false };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function currentX(): number {
  return pos.value.x >= 0 ? pos.value.x : window.innerWidth - 62;
}

function onMove(e: PointerEvent): void {
  if (!drag) return;
  const dx = e.clientX - drag.px;
  const dy = e.clientY - drag.py;
  if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
  pos.value = { x: Math.min(Math.max(e.clientX - 24, 0), window.innerWidth - 40), y: clampY(drag.y + dy) };
}

function onUp(): void {
  if (!drag) return;
  const clicked = !drag.moved;
  // 吸附回最近边缘
  const nearRight = pos.value.x > window.innerWidth / 2;
  pos.value = { x: nearRight ? window.innerWidth - 62 : 6, y: clampY(pos.value.y) };
  drag = null;
  if (clicked) togglePanel();
}

onMounted(() => {
  pos.value = { x: -1, y: clampY(pos.value.y) };
});
</script>

<template>
  <div
    ref="el"
    class="tlb-orb"
    title="Tag 实验室"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <i class="fa-solid fa-flask" />
  </div>
</template>

<style scoped>
.tlb-orb {
  position: fixed;
  z-index: 10005;
  right: -14px;
  top: 120px;
  width: 44px;
  height: 44px;
  margin-right: 14px;
  border-radius: var(--tlb-radius-pill);
  background: var(--tlb-accent);
  color: var(--tlb-accent-ink);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: grab;
  box-shadow: var(--tlb-shadow);
  user-select: none;
  touch-action: none;
  transition: transform var(--tlb-dur) var(--tlb-ease), box-shadow var(--tlb-dur) var(--tlb-ease);
}

.tlb-orb:hover {
  transform: scale(1.08);
}

.tlb-orb:active {
  cursor: grabbing;
}
</style>
