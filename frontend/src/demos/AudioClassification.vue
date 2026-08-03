<template>
  <div class="ac-root">

    <!-- About card -->
    <v-expansion-panels variant="accordion" flat>
      <v-expansion-panel class="ti-expansion">
        <v-expansion-panel-title class="exp-title">
          <v-icon size="16" color="primary" class="mr-2">mdi-information-outline</v-icon>
          About
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <p class="desc-text">
            Real-time audio event classification using YAMNet model on C7x DSP via TIDL.
            Predicts 521 audio event classes from the AudioSet ontology with low latency.
          </p>
          <ul class="feat-list">
            <li><v-icon size="14" color="success" class="mr-1">mdi-check</v-icon>521 audio event classes</li>
            <li><v-icon size="14" color="success" class="mr-1">mdi-check</v-icon>MobileNet v1 architecture</li>
            <li><v-icon size="14" color="success" class="mr-1">mdi-check</v-icon>TIDL-accelerated inference</li>
            <li><v-icon size="14" color="success" class="mr-1">mdi-check</v-icon>Real-time audio processing</li>
          </ul>
          <div class="tags">
            <v-chip size="x-small" color="primary" variant="tonal">Audio Classification</v-chip>
            <v-chip size="x-small" color="info" variant="tonal">TIDL</v-chip>
            <v-chip size="x-small" color="success" variant="tonal">C7x DSP</v-chip>
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
          <div class="model-row"><span class="model-lbl">Architecture</span><span class="model-val">YAMNet (MobileNet v1)</span></div>
          <div class="model-row"><span class="model-lbl">Quantization</span><span class="model-val">INT8</span></div>
          <div class="model-row"><span class="model-lbl">Runtime</span><span class="model-val">TIDL</span></div>
          <div class="model-row"><span class="model-lbl">Target</span><span class="model-val">C7x DSP</span></div>
          <div class="model-row"><span class="model-lbl">Classes</span><span class="model-val">521 (AudioSet)</span></div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <!-- Controls + status row -->
    <v-card flat class="ti-card ctrl-card">
      <div class="ctrl-row">
        <!-- Input device selector -->
        <div class="field-wrap">
          <label class="field-lbl">Input Device</label>
          <select v-model="selectedDevice" class="field-select" :disabled="isRunning">
            <option v-if="devices.length === 0" value="">Loading...</option>
            <option v-for="d in devices" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>

        <!-- Status indicator -->
        <div class="status-wrap">
          <div class="status-dot" :class="isRunning ? 'dot-run' : 'dot-idle'" />
          <span class="status-txt">{{ isRunning ? 'Running' : 'Idle' }}</span>
        </div>
      </div>

      <div v-if="errorMsg" class="err-banner">
        <v-icon size="14" color="error">mdi-alert-circle</v-icon>
        {{ errorMsg }}
      </div>
    </v-card>

    <!-- Signal flow image -->
    <div class="flow-wrap">
      <img src="/images/audio-classification-flow.png" alt="Audio Classification Signal Flow" class="flow-img" @error="flowImgError = true" v-if="!flowImgError" />
    </div>

    <!-- Results panel -->
    <v-card flat class="ti-card results-card">
      <div class="results-hdr">
        <span class="results-ttl">Classification Results</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="results-count">{{ results.length }} event{{ results.length !== 1 ? 's' : '' }}</span>
          <v-btn icon size="x-small" variant="text" title="Clear" @click="results = []">
            <v-icon size="14">mdi-delete-outline</v-icon>
          </v-btn>
        </div>
      </div>

      <div class="results-list" ref="resultsEl">
        <div v-if="results.length === 0" class="results-empty">
          {{ isRunning ? 'Waiting for classification events…' : 'Start the demo to see classification results.' }}
        </div>
        <div v-for="(r, i) in results" :key="i" class="result-row">
          <div class="r-idx">{{ results.length - i }}</div>
          <div class="r-class">{{ r.class }}</div>
          <div class="r-time">{{ r.time }}</div>
        </div>
      </div>
    </v-card>

    <!-- Not Supported Dialog -->
    <v-dialog v-model="notSupportedDialog" max-width="420">
      <v-card>
        <v-card-title class="d-flex align-center gap-2 pa-4">
          <v-icon color="warning" size="24">mdi-alert-circle-outline</v-icon>
          Demo Not Supported
        </v-card-title>
        <v-card-text class="pa-4 pt-0">
          This demo is not currently supported on this board configuration.
        </v-card-text>
        <v-card-actions class="pa-4 pt-0">
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="notSupportedDialog = false">OK</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const isRunning     = ref(false)
const devices       = ref([])
const selectedDevice = ref('')
const results       = ref([])
const errorMsg      = ref('')
const flowImgError  = ref(false)
const resultsEl     = ref(null)
const notSupportedDialog = ref(false)
let ws = null

const MAX_RESULTS = 50

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function loadDevices() {
  try {
    const d = await fetch('/audio-devices').then(r => r.json())
    const list = Array.isArray(d) ? d : (d.devices || [])
    devices.value = list.map(item => {
      if (typeof item === 'string') {
        const [value, ...labelParts] = item.split('|')
        return { value: value.trim(), label: (labelParts.join('|') || value).trim() }
      }
      return { value: item.id || item.value || item, label: item.name || item.label || item.id || item }
    })
    if (devices.value.length > 0 && !selectedDevice.value) {
      selectedDevice.value = devices.value[0].value
    }
  } catch (_) {
    devices.value = [{ value: 'default', label: 'Default Device' }]
    selectedDevice.value = 'default'
  }
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${proto}//${location.host}/audio`)

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data)
      const cls = msg.class || msg.label || msg.event || ''
      if (!cls) return
      results.value.unshift({ class: cls, time: fmtTime(msg.timestamp) })
      if (results.value.length > MAX_RESULTS) results.value.length = MAX_RESULTS
    } catch (_) {}
  }

  ws.onerror = () => { errorMsg.value = 'WebSocket error on /audio' }
  ws.onclose = () => {
    if (isRunning.value) {
      setTimeout(connectWs, 2000)
    }
  }
}

async function run() {
  notSupportedDialog.value = true
}

async function stop() {
  if (!isRunning.value) return
  isRunning.value = false
  if (ws) { ws.close(); ws = null }
  try { await fetch('/stop-audio-classification') } catch (_) {}
}

onMounted(loadDevices)
onUnmounted(() => { if (ws) { ws.close(); ws = null } })

defineExpose({ run, stop, isRunning })
</script>

<style scoped>
.ac-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  overflow-y: auto;
  padding: 2px;
}

.ti-card {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-border-color),var(--v-border-opacity)) !important;
  border-radius: 12px !important;
  padding: 14px !important;
  flex-shrink: 0;
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

/* Controls card */
.ctrl-card { display:flex; flex-direction:column; gap:10px; }
.ctrl-row  { display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap; }
.field-wrap { display:flex; flex-direction:column; gap:4px; min-width:180px; flex:1; }
.field-lbl  { font-size:11px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:1px; }
.field-select {
  background: rgb(var(--v-theme-background));
  border: 1px solid rgba(var(--v-border-color),var(--v-border-opacity));
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px; padding: 7px 10px;
  border-radius: 6px; outline: none; cursor: pointer; width: 100%;
}
.field-select:disabled { opacity: 0.5; cursor: not-allowed; }

.status-wrap { display:flex; align-items:center; gap:8px; flex-shrink:0; padding-bottom:7px; }
.status-dot  { width:9px; height:9px; border-radius:50%; transition:background 0.3s; }
.dot-idle { background:#475569; }
.dot-run  { background:#22c55e; box-shadow:0 0 8px #22c55e; animation:spulse 2s infinite; }
@keyframes spulse { 0%,100%{box-shadow:0 0 4px #22c55e} 50%{box-shadow:0 0 12px #22c55e} }
.status-txt  { font-size:13px; color:rgb(var(--v-theme-on-surface)); font-weight:600; }

.err-banner { display:flex; align-items:center; gap:7px; font-size:12px; color:#f87171; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:7px; padding:8px 12px; }

/* Signal flow */
.flow-wrap { flex-shrink:0; }
.flow-img  { width:100%; display:block; border-radius:8px; border:1px solid rgba(var(--v-border-color),var(--v-border-opacity)); }

/* Results */
.results-card { display:flex; flex-direction:column; gap:0; flex:1; min-height:180px; overflow:hidden; padding:0 !important; }
.results-hdr  { display:flex; align-items:center; justify-content:space-between; padding:12px 14px 10px; border-bottom:1px solid rgba(var(--v-border-color),var(--v-border-opacity)); flex-shrink:0; }
.results-ttl  { font-size:13px; font-weight:700; color:rgb(var(--v-theme-on-surface)); }
.results-count { font-size:11px; color:#64748b; background:rgb(var(--v-theme-surface-variant)); padding:2px 8px; border-radius:10px; }

.results-list  { flex:1; overflow-y:auto; padding:8px 14px; display:flex; flex-direction:column; gap:5px; }
.results-empty { font-size:13px; color:#475569; text-align:center; padding:24px 0; }

.result-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid rgba(var(--v-border-color),var(--v-border-opacity)); border-radius:8px; font-size:13px; background:rgb(var(--v-theme-background)); }
.r-idx   { font-size:11px; color:#475569; width:22px; text-align:right; flex-shrink:0; }
.r-class { flex:1; color:rgb(var(--v-theme-on-surface)); font-weight:500; }
.r-time  { font-size:11px; color:#64748b; flex-shrink:0; }
</style>
