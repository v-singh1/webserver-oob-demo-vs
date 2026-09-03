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

          <!-- Signal flow image -->
          <img src="/images/audio-classification-flow.png" alt="Audio Classification Pipeline" class="flow-img" />

          <!-- Features -->
          <ul class="feat-list">
            <li v-for="f in features" :key="f">
              <v-icon size="14" color="success" class="mr-1">mdi-check</v-icon>
              {{ f }}
            </li>
          </ul>

          <!-- Tags -->
          <div class="tags">
            <v-chip v-for="t in tags" :key="t" size="x-small" color="primary" variant="tonal">{{ t }}</v-chip>
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
          <div class="model-row"><span class="model-lbl">Architecture</span><span class="model-val">{{ currentModelMeta.architecture }}</span></div>
          <div class="model-row"><span class="model-lbl">Runtime</span>      <span class="model-val">TVM + TIDL</span></div>
          <div class="model-row"><span class="model-lbl">Target</span>       <span class="model-val">C7x DSP</span></div>
          <div class="model-row"><span class="model-lbl">Input</span>        <span class="model-val">16kHz mono PCM</span></div>
          <div class="model-row"><span class="model-lbl">Classes</span>      <span class="model-val">{{ currentModelMeta.classes }}</span></div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <!-- Model selector -->
    <v-card class="ti-card" flat>
      <div class="card-ttl">Model</div>
      <div class="source-actions">
        <div class="field-wrap">
          <label class="field-lbl">Classification Model</label>
          <select v-model="selectedModel" class="field-select" :disabled="isRunning">
            <option v-for="(m, key) in modelMap" :key="key" :value="key">{{ m.label }}</option>
          </select>
        </div>
      </div>
      <div v-if="modelMap[selectedModel]?.description" class="model-desc">
        {{ modelMap[selectedModel].description }}
      </div>
    </v-card>

    <!-- Audio source card -->
    <v-card class="ti-card" flat>
      <div class="card-ttl">Audio Source</div>

      <div class="file-card">
        <div class="file-card-icon">
          <v-icon size="20" color="primary">{{ selectedSourceIsFile ? 'mdi-file-music' : 'mdi-microphone' }}</v-icon>
        </div>
        <div class="file-card-info">
          <div class="file-card-name">{{ selectedSource?.label || 'No audio source available' }}</div>
          <div class="file-card-meta">{{ sourceSummary }}</div>
          <v-chip size="x-small" :color="selectedSourceIsFile ? 'primary' : 'success'" variant="tonal" class="mt-1">
            {{ selectedSourceIsFile ? (uploadedPath ? 'Uploaded File' : 'Default File') : 'Live Microphone' }}
          </v-chip>
        </div>
      </div>

      <div class="source-actions">
        <div class="field-wrap">
          <label class="field-lbl">Input Source</label>
          <select v-model="selectedDevice" class="field-select" :disabled="isRunning">
            <option v-if="devices.length === 0" value="">Loading...</option>
            <option v-for="d in devices" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>
        <v-btn size="small" variant="outlined" color="primary" prepend-icon="mdi-refresh" :disabled="isRunning" @click="loadDevices">
          Refresh
        </v-btn>
        <v-btn size="small" variant="outlined" color="primary" prepend-icon="mdi-upload" :disabled="isRunning" @click="chooseUpload">
          Upload WAV File
        </v-btn>
        <input ref="uploadInput" type="file" accept=".wav,audio/wav" hidden @change="uploadFile" />
      </div>
    </v-card>

    <!-- Status -->
    <v-card class="ti-card" flat>
      <div class="status-row">
        <div class="status-dot-wrap">
          <span class="status-dot" :class="dotClass" />
          <span class="status-bars" :class="{ active: isRunning }">
            <span v-for="i in 5" :key="i" :style="barStyle(i)" />
          </span>
        </div>
        <span class="status-lbl">{{ statusMessage }}</span>
      </div>

      <v-alert v-if="modelLoading" type="info" variant="tonal" density="compact" icon="mdi-cog-sync-outline" class="model-loading-alert">
        <span class="model-loading-txt">
          <span class="ac-spinner">&#9696;</span>
          <span><strong>{{ modelName || 'Model' }} loading</strong> — please wait, this may take up to 15 seconds</span>
        </span>
      </v-alert>

      <v-alert v-if="errorMsg" type="error" density="compact" variant="tonal" closable @click:close="errorMsg = ''">
        {{ errorMsg }}
      </v-alert>
    </v-card>

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

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  getAudioClassificationInfo,
  getAudioClassificationModels,
  getAudioDevices,
  startAudioClassification,
  stopAudioClassification,
  uploadAudioClassificationFile,
} from '@/utils/audioClassificationApi'

const emit = defineEmits(['running-change'])

const isRunning      = ref(false)
const modelLoading   = ref(false)
const modelName      = ref('')
const devices        = ref([])
const selectedDevice = ref('')
const results        = ref([])
const errorMsg       = ref('')
const statusMessage  = ref('Idle')
const fileInfo       = ref(null)
const uploadedPath   = ref('')
const uploadedName   = ref('')
const uploadInput    = ref(null)
const resultsEl      = ref(null)
const modelMap       = ref({})         /* { yamnet: {label, description}, vggish: ... } */
const selectedModel  = ref('yamnet')
let ws = null
let reconnectTimer = null
let mounted = false

/* Static per-model metadata shown in the Model Info expansion panel */
const MODEL_META = {
  yamnet: { architecture: 'YAMNet (MobileNet v1)', classes: '521 (AudioSet)' },
  vggish: { architecture: 'VGGish',                classes: '10 (UrbanSound8K)' },
}

const MAX_RESULTS = 50
const features = [
  '521 AudioSet event classes',
  'STFT, Mel filtering, and log features on C7x DSP',
  'TVM + TIDL accelerated YAMNet inference',
  'Live ALSA microphone and WAV file input',
]
const tags = ['Audio Classification', 'TVM + TIDL', 'C7x DSP']

const currentModelMeta = computed(() =>
  MODEL_META[selectedModel.value] || { architecture: selectedModel.value, classes: '—' }
)
const selectedSource = computed(() =>
  devices.value.find(device => device.value === selectedDevice.value) || null
)
const selectedSourceIsFile = computed(() => selectedDevice.value.startsWith('file:'))
const sourceSummary = computed(() => {
  if (!selectedSource.value) return 'Refresh to discover available audio sources'
  if (selectedSourceIsFile.value) {
    return uploadedPath.value && selectedDevice.value === `file:${uploadedPath.value}`
      ? `Uploaded WAV · ${uploadedName.value}`
      : 'Installed WAV file input'
  }
  const seconds = fileInfo.value?.captureSeconds || 3
  const rate = fileInfo.value?.sampleRate || 16000
  return `Live ALSA capture · ${rate / 1000}kHz mono PCM · ${seconds}s`
})
const dotClass = computed(() => ({
  'dot-running': isRunning.value,
  'dot-error': Boolean(errorMsg.value),
  'dot-success': !isRunning.value && !errorMsg.value && statusMessage.value === 'Classification completed',
  'dot-idle': !isRunning.value && !errorMsg.value && statusMessage.value !== 'Classification completed',
}))

function barStyle(i) {
  const delays = [0, 100, 200, 300, 150]
  return { animationDelay: `${delays[i - 1]}ms` }
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function loadDevices() {
  try {
    const discovered = await getAudioDevices()
    if (uploadedPath.value) {
      discovered.unshift({ value: `file:${uploadedPath.value}`, label: uploadedName.value || 'Uploaded WAV file' })
    }
    devices.value = discovered
    if (!devices.value.some(device => device.value === selectedDevice.value)) {
      selectedDevice.value = devices.value[0]?.value || ''
    }
    if (devices.value.length === 0) errorMsg.value = 'No audio sources found'
  } catch (error) {
    devices.value = []
    selectedDevice.value = ''
    errorMsg.value = error.message
  }
}

async function loadInfo() {
  try { fileInfo.value = await getAudioClassificationInfo() }
  catch (_) { /* Older/non-AM62D servers do not expose this optional metadata. */ }
}

async function loadModels() {
  try {
    const data = await getAudioClassificationModels()
    if (data.models && Object.keys(data.models).length) {
      modelMap.value = data.models
      if (data.default && data.models[data.default]) selectedModel.value = data.default
    }
  } catch (_) {}
}

function chooseUpload() {
  uploadInput.value?.click()
}

async function uploadFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!/\.wav$/i.test(file.name)) {
    errorMsg.value = 'Audio Classification input must be a WAV file'
    return
  }
  try {
    errorMsg.value = ''
    statusMessage.value = 'Uploading WAV file'
    const result = await uploadAudioClassificationFile(file)
    uploadedPath.value = result.path
    uploadedName.value = result.name || file.name
    const option = { value: `file:${result.path}`, label: uploadedName.value }
    devices.value = [option, ...devices.value.filter(device => device.value !== option.value)]
    selectedDevice.value = option.value
    statusMessage.value = 'Ready'
  } catch (error) {
    statusMessage.value = 'Idle'
    errorMsg.value = error.message
  }
}

function closeSocket() {
  if (!ws) return
  const socket = ws
  ws = null
  try { socket.close() } catch (_) {}
}

function connectWs() {
  clearTimeout(reconnectTimer)
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve()
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(`${proto}//${location.host}/audio`)
  ws = socket

  const opened = new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Timed out connecting to Audio Classification results'))
      try { socket.close() } catch (_) {}
    }, 5000)

    socket.onopen = () => {
      clearTimeout(timeout)
      errorMsg.value = ''
      if (!settled) { settled = true; resolve() }
    }

    socket.onerror = () => {
      errorMsg.value = 'WebSocket error on /audio'
      if (!settled) {
        clearTimeout(timeout)
        settled = true
        reject(new Error(errorMsg.value))
      }
    }

    socket.onclose = () => {
      clearTimeout(timeout)
      if (ws === socket) ws = null
      if (!settled) {
        settled = true
        reject(new Error('Audio Classification result connection closed'))
      } else if (mounted && isRunning.value) {
        reconnectTimer = setTimeout(() => {
          connectWs().catch(error => { errorMsg.value = error.message })
        }, 2000)
      }
    }
  })

  socket.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'model_loading') {
        modelLoading.value = true
        modelName.value    = msg.modelName || ''
        statusMessage.value = `Loading ${msg.modelName || 'model'}…`
        return
      }
      if (msg.type === 'error') {
        modelLoading.value = false
        isRunning.value = false
        emit('running-change', false)
        statusMessage.value = 'Classification failed'
        errorMsg.value = msg.message || 'Audio classification failed'
        closeSocket()
        return
      }
      if (msg.type === 'complete' || (msg.type === 'status' && msg.status === 'stopped')) {
        modelLoading.value = false
        isRunning.value = false
        emit('running-change', false)
        statusMessage.value = msg.type === 'complete' ? 'Classification completed' : 'Idle'
        closeSocket()
        return
      }
      if (msg.type === 'status') {
        statusMessage.value = msg.message || msg.status || 'Running'
        return
      }
      const cls = msg.class || msg.label || msg.event || ''
      if (!cls) return
      modelLoading.value = false
      results.value.unshift({ class: cls, time: fmtTime(msg.timestamp) })
      if (results.value.length > MAX_RESULTS) results.value.length = MAX_RESULTS
    } catch (_) {}
  }
  return opened
}

async function run() {
  if (isRunning.value) return
  errorMsg.value = ''
  results.value = []

  try {
    /* Shared flow for both backends: stop a stale run, open the result socket,
     * then start the selected source.  The server chooses GStreamer or RPMsg. */
    await stopAudioClassification()
    isRunning.value = true
    emit('running-change', true)
    statusMessage.value = 'Connecting to result stream'
    await connectWs()
    statusMessage.value = 'Starting classification'
    await startAudioClassification(selectedDevice.value, selectedModel.value)
  } catch (error) {
    clearTimeout(reconnectTimer)
    closeSocket()
    isRunning.value = false
    emit('running-change', false)
    statusMessage.value = 'Classification failed'
    errorMsg.value = error.message
  }
}

async function stop() {
  clearTimeout(reconnectTimer)
  isRunning.value    = false
  modelLoading.value = false
  emit('running-change', false)
  closeSocket()
  statusMessage.value = 'Idle'
  try { await stopAudioClassification() }
  catch (error) { errorMsg.value = error.message }
}

onMounted(() => {
  mounted = true
  Promise.all([loadInfo(), loadDevices(), loadModels()])
})
onUnmounted(() => {
  mounted = false
  clearTimeout(reconnectTimer)
  if (isRunning.value) stop()
  else closeSocket()
})

defineExpose({ run, stop, isRunning, isModelLoading: modelLoading })
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
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.card-ttl { font-size:12.5px; font-weight:700; color:rgb(var(--v-theme-on-surface)); }
.desc-text { font-size: 13px; color: #94a3b8; line-height: 1.65; margin-bottom: 10px; }
.feat-list { list-style:none; display:flex; flex-direction:column; gap:4px; }
.feat-list li { display:flex; align-items:flex-start; gap:6px; font-size:12px; color:#94a3b8; }
.tags { display:flex; flex-wrap:wrap; gap:6px; }

.model-row { display:flex; justify-content:space-between; font-size:12px; }
.model-lbl { color:#64748b; }
.model-val { color:#94a3b8; font-weight:600; }

/* Audio source */
.file-card       { display:flex; align-items:flex-start; gap:10px; background:rgb(var(--v-theme-surface-variant)); border:1px solid rgba(var(--v-border-color),var(--v-border-opacity)); border-radius:8px; padding:10px; }
.file-card-icon  { width:36px; height:36px; border-radius:8px; background:rgba(77,166,255,0.1); border:1px solid rgba(77,166,255,0.3); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.file-card-info  { min-width:0; flex:1; }
.file-card-name  { font-size:13px; font-weight:600; color:rgb(var(--v-theme-on-surface)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.file-card-meta  { font-size:11px; color:#64748b; margin-top:2px; }
.source-actions  { display:flex; align-items:flex-end; gap:8px; flex-wrap:wrap; }
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

/* Status */
.status-row      { display:flex; align-items:center; gap:10px; }
.status-dot-wrap { display:flex; align-items:center; gap:6px; }
.status-dot      { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.dot-running { background:#4da6ff; box-shadow:0 0 8px #4da6ff; animation:pulse 1.2s infinite; }
.dot-success { background:#22c55e; box-shadow:0 0 8px #22c55e; }
.dot-error   { background:#ef4444; box-shadow:0 0 8px #ef4444; }
.dot-idle    { background:#475569; }
.status-lbl  { font-size:13px; }
.status-bars { display:none; align-items:flex-end; gap:2px; height:16px; }
.status-bars.active { display:inline-flex; }
.status-bars span { display:inline-block; width:3px; border-radius:1px; height:3px; background:#4da6ff; animation:bar-rise .7s ease-in-out infinite; }
@keyframes bar-rise { 0%,100%{height:3px} 50%{height:14px} }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
@keyframes spin   { to { transform: rotate(360deg); } }

/* Model loading alert */
.model-loading-alert { flex-shrink: 0; }
.model-loading-txt   { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.ac-spinner          { display: inline-block; animation: spin 1.2s linear infinite; font-size: 16px; line-height: 1; }

/* Signal flow */
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

.model-desc { font-size:11px; color:#64748b; margin-top:4px; }
</style>
