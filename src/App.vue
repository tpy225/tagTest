<script setup lang="ts">
/**
 * 根组件:主题容器 + 浮动球 + 浮动面板(三页切换)。
 * 生成页常驻挂载(保留输入状态);画廊/设置按需挂载。
 */
import { computed, onMounted } from 'vue';

import FloatingOrb from '@/components/FloatingOrb.vue';
import FloatingPanel from '@/components/FloatingPanel.vue';
import ArtistCompare from '@/components/ArtistCompare.vue';
import BotPanel from '@/components/BotPanel.vue';
import GalleryPanel from '@/components/GalleryPanel.vue';
import GenPanel from '@/components/GenPanel.vue';
import SettingsPanel from '@/components/SettingsPanel.vue';
import { loadHistory } from '@/state/historyList';
import { loadVibes } from '@/state/vibeList';
import { settings } from '@/state/settings';
import { ui } from '@/state/ui';

const theme = computed(() => settings.theme);

onMounted(() => {
  void loadHistory(); // 启动即载一次,画廊/回填直接可用
  void loadVibes(); // vibe 列表,生成时叠加用
});
</script>

<template>
  <div class="tlb-root" :data-theme="theme">
    <FloatingOrb v-if="settings.orbEnabled" />
    <FloatingPanel v-if="ui.panelOpen">
      <GenPanel v-show="ui.tab === 'gen'" />
      <ArtistCompare v-if="ui.tab === 'compare'" />
      <BotPanel v-show="ui.tab === 'bot'" />
      <GalleryPanel v-if="ui.tab === 'gallery'" />
      <GalleryPanel v-if="ui.tab === 'favorites'" favorites-only />
      <SettingsPanel v-if="ui.tab === 'settings'" />
    </FloatingPanel>
  </div>
</template>
