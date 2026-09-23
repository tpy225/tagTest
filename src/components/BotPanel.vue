<script setup lang="ts">
/**
 * Bot 页:与「Tag Bot」对话写 tag。
 * - 自配 OpenAI 兼容接口(设置页配 baseUrl/key/model/systemPrompt)。
 * - 每条 assistant 回复带「填入提示词」,把回复里的 tag 填入生成页正向框并切到生成页。
 * 对话存内存(组件用 v-show 常驻,切换 tab 不丢);不持久化。
 */
import { nextTick, ref } from 'vue';

import { chat, extractTags, type BotMessage } from '@/nai/bot';
import { openPanel, promptDraft } from '@/state/ui';
import { notify } from '@/st/toast';

interface ChatLine {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

const lines = ref<ChatLine[]>([]);
const draftInput = ref('');
const busy = ref(false);
const error = ref('');
const lastId = ref(0);
const listEl = ref<HTMLElement | null>(null);

function scrollToBottom(): void {
  void nextTick(() => {
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' });
  });
}

async function send(): Promise<void> {
  const text = draftInput.value.trim();
  if (!text || busy.value) return;
  draftInput.value = '';
  error.value = '';
  lines.value.push({ id: ++lastId.value, role: 'user', content: text });
  scrollToBottom();

  busy.value = true;
  try {
    const messages: BotMessage[] = lines.value.map(l => ({ role: l.role, content: l.content }));
    const reply = await chat(messages);
    lines.value.push({ id: ++lastId.value, role: 'assistant', content: reply });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    scrollToBottom();
  }
}

/** 把某条 assistant 回复的 tag 填入生成页并切过去。 */
function fillPrompt(content: string): void {
  const tags = extractTags(content);
  if (!tags) {
    notify('warning', '没有可填入的 tag');
    return;
  }
  promptDraft.text = tags;
  openPanel('gen');
  notify('success', 'tag 已填入正向提示词');
}

function clearChat(): void {
  lines.value = [];
  error.value = '';
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    void send();
  }
}
</script>

<template>
  <div class="tlb-bot">
    <div ref="listEl" class="tlb-bot__list tlb-scroll">
      <div v-if="!lines.length" class="tlb-bot__empty">
        <i class="fa-solid fa-robot" />
        <p>用自然语言描述想要的画面,Bot 帮你写 tag。</p>
        <p class="tlb-hint">示例:「一个银发少女,黄昏的窗边,柔和的光」</p>
      </div>

      <div v-for="line in lines" :key="line.id" class="tlb-bot__line" :class="`tlb-bot__line--${line.role}`">
        <div class="tlb-bot__bubble">
          <span class="tlb-bot__who">{{ line.role === 'user' ? '我' : 'Bot' }}</span>
          <div class="tlb-bot__text">{{ line.content }}</div>
          <button v-if="line.role === 'assistant'" class="tlb-btn tlb-btn--accent tlb-btn--sm tlb-bot__fill" @click="fillPrompt(line.content)">
            <i class="fa-solid fa-arrow-left" /> 填入提示词
          </button>
        </div>
      </div>

      <div v-if="busy" class="tlb-bot__line tlb-bot__line--assistant">
        <div class="tlb-bot__bubble"><i class="fa-solid fa-spinner fa-spin" /> 思考中…</div>
      </div>
      <p v-if="error" class="tlb-bot__error">{{ error }}</p>
    </div>

    <div class="tlb-bot__composer">
      <textarea
        v-model="draftInput"
        class="tlb-textarea"
        rows="2"
        :placeholder="busy ? '生成中…' : '描述画面,或粘贴参考描述(Cmd/Ctrl+Enter 发送)'"
        @keydown="onKeydown"
      />
      <div class="tlb-row tlb-bot__actions">
        <button class="tlb-btn tlb-btn--ghost tlb-btn--sm" :disabled="!lines.length" @click="clearChat">清空对话</button>
        <span class="tlb-grow" />
        <button class="tlb-btn tlb-btn--accent tlb-btn--sm" :disabled="busy || !draftInput.trim()" @click="send">
          <i class="fa-solid fa-paper-plane" /> 发送
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tlb-bot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
}

.tlb-bot__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 50vh;
  overflow-y: auto;
  padding-right: 4px;
}

.tlb-bot__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--tlb-ink-muted);
  padding: 60px 0;
  text-align: center;
}

.tlb-bot__empty i {
  font-size: 34px;
}

.tlb-bot__line {
  display: flex;
}

.tlb-bot__line--user {
  justify-content: flex-end;
}

.tlb-bot__line--assistant {
  justify-content: flex-start;
}

.tlb-bot__bubble {
  max-width: 86%;
  padding: 8px 12px;
  border-radius: var(--tlb-radius);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tlb-bot__line--user .tlb-bot__bubble {
  background: var(--tlb-accent);
  color: var(--tlb-accent-ink);
}

.tlb-bot__line--assistant .tlb-bot__bubble {
  background: var(--tlb-surface);
  border: 1px solid var(--tlb-line);
}

.tlb-bot__who {
  font-size: 11px;
  font-weight: 700;
  opacity: 0.7;
}

.tlb-bot__text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.tlb-bot__fill {
  align-self: flex-start;
}

.tlb-bot__error {
  color: var(--tlb-danger);
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
}

.tlb-bot__composer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--tlb-line);
}
</style>