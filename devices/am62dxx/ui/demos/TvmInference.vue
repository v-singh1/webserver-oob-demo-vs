<template>
  <div class="tvm-panel">
    <!-- About card -->
    <v-expansion-panels variant="accordion" flat>
      <v-expansion-panel class="ti-expansion">
        <v-expansion-panel-title class="exp-title">
          <v-icon size="16" color="primary" class="mr-2">mdi-information-outline</v-icon>
          About
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <p class="desc-text">
            Hardware-accelerated speech enhancement inference using TVM+TIDL runtime on AM62D C7x DSP.
            Runs GCRN FP32 model for noise reduction and speech quality improvement.
          </p>
          <ul class="feat-list">
            <li><v-icon size="14" color="success" class="mr-1">mdi-check</v-icon>TVM compilation framework</li>
            <li><v-icon size="14" color="success" class="mr-1">mdi-check</v-icon>TIDL acceleration on C7x DSP</li>
            <li><v-icon size="14" color="success" class="mr-1">mdi-check</v-icon>Speech enhancement inference</li>
            <li><v-icon size="14" color="success" class="mr-1">mdi-check</v-icon>Low-latency processing</li>
          </ul>
          <div class="tags">
            <v-chip size="x-small" color="primary" variant="tonal">TVM Inference</v-chip>
            <v-chip size="x-small" color="info" variant="tonal">C7x DSP</v-chip>
            <v-chip size="x-small" color="warning" variant="tonal">AI / ML</v-chip>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <!-- Model card -->
    <v-expansion-panels variant="accordion" flat>
      <v-expansion-panel class="ti-expansion">
        <v-expansion-panel-title class="exp-title">
          <v-icon size="16" color="primary" class="mr-2">mdi-brain</v-icon>
          Model Info
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="model-row"><span class="model-lbl">Architecture</span><span class="model-val">GCRN</span></div>
          <div class="model-row"><span class="model-lbl">Precision</span><span class="model-val">FP32</span></div>
          <div class="model-row"><span class="model-lbl">Runtime</span><span class="model-val">TVM + TIDL</span></div>
          <div class="model-row"><span class="model-lbl">Target</span><span class="model-val">C7x DSP</span></div>
          <div class="model-row"><span class="model-lbl">Task</span><span class="model-val">Speech Enhancement</span></div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-card class="ti-card" flat>
      <div class="card-ttl">Status</div>
      <div class="status-row">
        <span class="status-dot" :class="running ? 'dot-running' : 'dot-idle'" />
        <span class="status-bars" :class="{ active: running }">
          <span v-for="i in 5" :key="i" :style="{ animationDelay: [0,100,200,300,150][i-1]+'ms' }" />
        </span>
        <span :class="running ? 'text-primary' : 'text-secondary'">{{ statusMsg }}</span>
      </div>

      <v-alert v-if="error" type="error" density="compact" variant="tonal">{{ error }}</v-alert>

      <div v-if="results" class="results-grid">
        <div class="result-cell">
          <div class="result-val">{{ results.inferenceTimeMs != null ? results.inferenceTimeMs.toFixed(1) + ' ms' : '—' }}</div>
          <div class="result-lbl">Inference Time</div>
        </div>
        <div class="result-cell">
          <div class="result-val">{{ results.outputFloats ?? '—' }}</div>
          <div class="result-lbl">Output Floats</div>
        </div>
        <div class="result-cell">
          <div class="result-val" style="font-size:13px">{{ results.cycles ?? '—' }}</div>
          <div class="result-lbl">C7x Cycles</div>
        </div>
      </div>
    </v-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const running   = ref(false)
const statusMsg = ref('Idle')
const error     = ref(null)
const results   = ref(null)

let pollTimer = null

async function run() {
  running.value   = true
  statusMsg.value = 'Running inference…'
  error.value     = null
  results.value   = null

  const r = await fetch('/tvm-inference/run')
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    error.value = d.error || `HTTP ${r.status}`
    running.value = false; statusMsg.value = 'Error'; return
  }

  pollTimer = setInterval(async () => {
    const s = await fetch('/tvm-inference/status').then(r => r.json()).catch(() => null)
    if (!s) return
    if (!s.isRunning) {
      clearInterval(pollTimer)
      running.value = false
      if (s.results?.error) { error.value = s.results.error; statusMsg.value = 'Error' }
      else { results.value = s.results; statusMsg.value = 'Complete' }
    }
  }, 500)
}

async function stop() {
  clearInterval(pollTimer)
  await fetch('/tvm-inference/stop')
  running.value = false; statusMsg.value = 'Stopped'
}

defineExpose({ run, stop, isRunning: running })
</script>

<style scoped>
.tvm-panel { display:flex; flex-direction:column; gap:12px; height:100%; overflow-y:auto; }
.ti-card {
  background:rgb(var(--v-theme-surface)) !important;
  border:1px solid rgba(var(--v-border-color),var(--v-border-opacity)) !important;
  border-radius:12px !important; padding:14px !important;
  display:flex; flex-direction:column; gap:8px;
}

/* Expansion panels */
.ti-expansion {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
  border-radius: 12px !important;
}
.exp-title {
  font-size: 12.5px;
  font-weight: 700;
  min-height: 48px !important;
}

.desc-text { font-size: 13px; color: #94a3b8; line-height: 1.65; margin-bottom: 10px; }
.feat-list { list-style:none; display:flex; flex-direction:column; gap:4px; margin-bottom: 10px; }
.feat-list li { display:flex; align-items:flex-start; gap:6px; font-size:12px; color:#94a3b8; }
.tags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom: 8px; }

.model-row { display:flex; justify-content:space-between; font-size:12px; padding: 4px 0; }
.model-lbl { color:#64748b; }
.model-val { color:#94a3b8; font-weight:600; }
.status-row { display:flex; align-items:center; gap:8px; font-size:13px; }
.status-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.dot-running{ background:#4da6ff; box-shadow:0 0 8px #4da6ff; animation:pulse 1.2s infinite; }
.dot-idle   { background:#475569; }
.status-bars{ display:none; align-items:flex-end; gap:2px; height:16px; }
.status-bars.active{ display:inline-flex; }
.status-bars span{ display:inline-block; width:3px; border-radius:1px; height:3px; background:#4da6ff; animation:bar-rise 0.7s ease-in-out infinite; }
@keyframes bar-rise{ 0%,100%{height:3px} 50%{height:14px} }
@keyframes pulse{ 0%,100%{opacity:1} 50%{opacity:0.5} }
.results-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:4px; }
.result-cell{ background:rgb(var(--v-theme-surface-variant)); border:1px solid rgba(var(--v-border-color),1); border-radius:8px; padding:12px; text-align:center; }
.result-val { font-size:18px; font-weight:700; color:#4da6ff; }
.result-lbl { font-size:11px; color:#64748b; margin-top:3px; }
</style>
