<template>
  <div class="gst-panel">

    <!-- Preset commands -->
    <v-card class="ti-card" flat>
      <div class="card-ttl">Pipeline Presets</div>
      <div class="preset-grid">
        <div
          v-for="p in PRESETS" :key="p.id"
          class="preset-chip"
          :class="{ active: selectedPreset === p.id }"
          :style="selectedPreset === p.id ? `border-color:${p.color};background:${p.color}18` : ''"
          @click="selectPreset(p)"
        >
          <v-icon size="13" :color="selectedPreset === p.id ? p.color : '#64748b'">{{ p.icon }}</v-icon>
          <span>{{ p.name }}</span>
        </div>
      </div>
    </v-card>

    <!-- Command editor -->
    <v-card class="ti-card" flat>
      <div class="card-ttl-row">
        <span class="card-ttl">GStreamer Command</span>
        <v-btn
          size="x-small" variant="text" color="primary"
          prepend-icon="mdi-content-copy"
          @click="copyCommand"
        >Copy</v-btn>
      </div>
      <textarea
        v-model="command"
        class="cmd-textarea"
        :disabled="isRunning"
        rows="5"
        spellcheck="false"
        placeholder="gst-launch-1.0 ..."
        @input="selectedPreset = 'custom'"
      />
      <div class="cmd-hint">
        <v-icon size="12" color="primary" class="mr-1">mdi-information-outline</v-icon>
        Select a preset above or write a custom <code>gst-launch-1.0</code> command
      </div>
    </v-card>

    <!-- TVM Artifacts -->
    <v-expansion-panels variant="accordion" flat>
      <v-expansion-panel class="ti-expansion" @group:selected="onArtifactPanelOpen">
        <v-expansion-panel-title class="exp-title">
          <v-icon size="16" color="primary" class="mr-2">mdi-folder-multiple-outline</v-icon>
          TVM Artifacts
          <v-chip v-if="artifacts.length" size="x-small" color="primary" variant="tonal" class="ml-2">{{ artifacts.length }}</v-chip>
        </v-expansion-panel-title>

        <v-expansion-panel-text>
          <div class="artifact-path-row">
            <v-icon size="13" color="primary">mdi-folder-cog-outline</v-icon>
            <code class="artifact-path">{{ artifactsDir }}</code>
          </div>

          <div class="artifact-toolbar">
            <v-btn size="small" variant="outlined" color="primary" prepend-icon="mdi-refresh"
              :loading="artifactsLoading" @click="loadArtifacts">Refresh</v-btn>
            <v-btn size="small" variant="outlined" color="primary" prepend-icon="mdi-upload"
              :loading="uploadLoading" @click="triggerUpload">Upload Archive</v-btn>
            <input ref="uploadRef" type="file" accept=".zip,.tar.gz,.tgz" hidden @change="uploadArtifact" />
          </div>

          <v-alert v-if="artifactError" type="error" density="compact" variant="tonal" class="mb-2" closable
            @click:close="artifactError = ''">{{ artifactError }}</v-alert>
          <v-alert v-if="uploadMsg" type="success" density="compact" variant="tonal" class="mb-2">{{ uploadMsg }}</v-alert>

          <div v-if="artifacts.length === 0 && !artifactsLoading" class="no-artifacts">
            No artifact directories found
          </div>

          <div v-for="a in artifacts" :key="a.name" class="artifact-row">
            <v-icon size="15" color="warning">mdi-folder-outline</v-icon>
            <div class="artifact-info">
              <span class="artifact-name">{{ a.name }}</span>
              <span class="artifact-meta">{{ a.fileCount }} file{{ a.fileCount !== 1 ? 's' : '' }}</span>
            </div>
            <div class="artifact-chips">
              <v-chip
                v-for="f in a.files.slice(0, 4)" :key="f"
                size="x-small" variant="tonal" color="secondary" class="mr-1"
              >{{ f }}</v-chip>
              <span v-if="a.files.length > 4" class="artifact-more">+{{ a.files.length - 4 }}</span>
            </div>
            <v-btn
              size="x-small" variant="tonal" color="primary"
              title="Insert artifact path into command"
              @click="insertArtifactPath(a)"
            >Use</v-btn>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <!-- Status -->
    <v-card class="ti-card" flat>
      <div class="status-row">
        <div class="status-dot-wrap">
          <span class="status-dot" :class="dotClass" />
          <span class="status-bars" :class="{ active: isRunning }">
            <span v-for="i in 5" :key="i" :style="{ animationDelay: [0,100,200,300,150][i-1]+'ms' }" />
          </span>
        </div>
        <span class="status-lbl">{{ statusMsg }}</span>
      </div>
      <v-alert v-if="errorMsg" type="error" density="compact" variant="tonal" closable @click:close="errorMsg = ''">
        {{ errorMsg }}
      </v-alert>
    </v-card>

    <!-- Output log -->
    <v-card flat class="ti-card log-card">
      <div class="log-hdr">
        <span class="log-ttl">Pipeline Output</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="log-count">{{ logLines.length }} line{{ logLines.length !== 1 ? 's' : '' }}</span>
          <v-btn icon size="x-small" variant="text" title="Clear log" @click="logLines = []">
            <v-icon size="14">mdi-delete-outline</v-icon>
          </v-btn>
        </div>
      </div>
      <div class="log-body" ref="logEl">
        <div v-if="logLines.length === 0" class="log-empty">
          {{ isRunning ? 'Waiting for pipeline output…' : 'Run a pipeline to see output here.' }}
        </div>
        <div v-for="(line, i) in logLines" :key="i" class="log-line" :class="line.cls">
          <span class="log-ts">{{ line.ts }}</span>
          <span class="log-text" style="white-space:pre-wrap">{{ line.text }}</span>
        </div>
      </div>
    </v-card>

  </div>
</template>

<script setup>
import { ref, computed, nextTick, onUnmounted } from 'vue'

const emit = defineEmits(['running-change'])

/* ── Presets ────────────────────────────────────────────────────── */

const PRESETS = [
  {
    id: 'speech-enhancement',
    name: 'Speech Enhancement',
    icon: 'mdi-microphone-outline',
    color: '#34d399',
    command:
      'gst-launch-1.0 filesrc location=/usr/share/tvm_inference/input/input_audio.wav ! wavparse ! audioconvert ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! tidlspeechenhance artifacts=/usr/share/tvm_inference/artifacts/gcrn ! wavenc ! filesink location=/tmp/gst_enhanced.wav',
  },
  {
    id: 'audio-class-yamnet',
    name: 'Classification (YAMNet)',
    icon: 'mdi-chart-bar',
    color: '#c084fc',
    command:
      'gst-launch-1.0 filesrc location=/usr/share/tvm_inference/input/input_audio.wav ! wavparse ! audioconvert ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! tidlaudioclassify artifacts=/usr/share/tvm_inference/artifacts/yamnet ! fakesink',
  },
  {
    id: 'audio-class-vggish',
    name: 'Classification (VGGish)',
    icon: 'mdi-chart-bar',
    color: '#a78bfa',
    command:
      'gst-launch-1.0 filesrc location=/usr/share/tvm_inference/input/input_audio.wav ! wavparse ! audioconvert ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! tidlaudioclassify artifacts=/usr/share/tvm_inference/artifacts/vggish ! fakesink',
  },
  {
    id: 'tvm-inference',
    name: 'TVM Inference',
    icon: 'mdi-flash',
    color: '#60a5fa',
    command:
      'gst-launch-1.0 filesrc location=/usr/share/tvm_inference/input/input_audio.wav ! wavparse ! audioconvert ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! tvminfer artifacts=/usr/share/tvm_inference/artifacts/gcrn ! fakesink',
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: 'mdi-pencil-outline',
    color: '#f59e0b',
    command: 'gst-launch-1.0 ',
  },
]

/* ── State ──────────────────────────────────────────────────────── */

const selectedPreset = ref('speech-enhancement')
const command        = ref(PRESETS[0].command)
const isRunning      = ref(false)
const statusMsg      = ref('Idle')
const errorMsg       = ref('')
const logLines       = ref([])
const logEl          = ref(null)
const uploadRef      = ref(null)

const artifacts      = ref([])
const artifactsDir   = ref('/usr/share/tvm_inference/artifacts')
const artifactsLoading = ref(false)
const artifactError  = ref('')
const uploadLoading  = ref(false)
const uploadMsg      = ref('')

let ws = null
let mounted = true

/* ── Computed ───────────────────────────────────────────────────── */

const dotClass = computed(() => ({
  'dot-running': isRunning.value,
  'dot-error':   Boolean(errorMsg.value),
  'dot-idle':    !isRunning.value && !errorMsg.value,
}))

/* ── Preset selection ───────────────────────────────────────────── */

function selectPreset(p) {
  selectedPreset.value = p.id
  if (p.id !== 'custom') command.value = p.command
}

/* ── WebSocket ──────────────────────────────────────────────────── */

function connectWs() {
  if (ws) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${proto}//${location.host}/gst`)
  ws.onopen  = () => {}
  ws.onclose = () => { ws = null }
  ws.onerror = () => { ws = null }
  ws.onmessage = ev => {
    try { dispatch(JSON.parse(ev.data)) } catch (_) {}
  }
}

function dispatch(msg) {
  switch (msg.type) {
    case 'connected':
      if (msg.running && !isRunning.value) {
        isRunning.value = true; statusMsg.value = 'Running'
        emit('running-change', true)
      }
      break
    case 'started':
      isRunning.value = true
      statusMsg.value = 'Pipeline running'
      errorMsg.value  = ''
      emit('running-change', true)
      appendLog(`▶ Started PID ${msg.pid}: ${msg.command}`, 'log-meta')
      break
    case 'log':
      msg.text.split('\n').forEach(line => {
        if (line) appendLog(line, msg.stream === 'stderr' ? 'log-stderr' : 'log-stdout')
      })
      break
    case 'error':
      errorMsg.value  = msg.message
      isRunning.value = false
      statusMsg.value = 'Error'
      emit('running-change', false)
      break
    case 'exit':
      isRunning.value = false
      emit('running-change', false)
      if (msg.reason === 'user stopped') {
        statusMsg.value = 'Stopped'
        appendLog('■ Pipeline stopped by user', 'log-meta')
      } else if (msg.code === 0 || msg.code === null) {
        statusMsg.value = 'Completed'
        appendLog(`■ Pipeline exited (code ${msg.code ?? '–'})`, 'log-meta')
      } else {
        statusMsg.value = `Exited (code ${msg.code})`
        appendLog(`■ Pipeline exited with code ${msg.code}`, 'log-stderr')
      }
      break
  }
}

function appendLog(text, cls = 'log-stdout') {
  const now = new Date()
  const ts  = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  logLines.value.push({ text, ts, cls })
  if (logLines.value.length > 2000) logLines.value.splice(0, logLines.value.length - 2000)
  nextTick(scrollLog)
}

function scrollLog() {
  if (!logEl.value) return
  const el = logEl.value
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  if (atBottom) el.scrollTop = el.scrollHeight
}

/* ── Run / Stop ─────────────────────────────────────────────────── */

async function run() {
  if (isRunning.value) return
  if (!command.value.trim()) { errorMsg.value = 'Enter a gst-launch command'; return }
  errorMsg.value  = ''
  statusMsg.value = 'Starting…'
  connectWs()
  try {
    const r = await fetch('/gst/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: command.value.trim() }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      errorMsg.value  = d.error || `HTTP ${r.status}`
      statusMsg.value = 'Failed to start'
    }
  } catch (e) {
    errorMsg.value  = e.message
    statusMsg.value = 'Failed to start'
  }
}

async function stop() {
  try {
    await fetch('/gst/stop', { method: 'POST' })
    isRunning.value = false
    statusMsg.value = 'Stopped'
    emit('running-change', false)
  } catch (_) {}
}

/* ── Artifacts ──────────────────────────────────────────────────── */

async function loadArtifacts() {
  artifactsLoading.value = true
  artifactError.value    = ''
  try {
    const r = await fetch('/gst/artifacts')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const d = await r.json()
    artifacts.value  = d.artifacts || []
    artifactsDir.value = d.dir || artifactsDir.value
  } catch (e) {
    artifactError.value = e.message
  } finally {
    artifactsLoading.value = false
  }
}

function onArtifactPanelOpen(val) {
  if (val.value && artifacts.value.length === 0) loadArtifacts()
}

function triggerUpload() { uploadRef.value?.click() }

async function uploadArtifact(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  uploadLoading.value = true
  uploadMsg.value     = ''
  artifactError.value = ''
  try {
    const url = `/gst/upload-artifact?name=${encodeURIComponent(file.name)}&filename=${encodeURIComponent(file.name)}`
    const r = await fetch(url, { method: 'POST', body: file })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      throw new Error(d.error || `HTTP ${r.status}`)
    }
    const d = await r.json()
    uploadMsg.value = `Uploaded "${d.name}" (${d.fileCount} files)`
    await loadArtifacts()
  } catch (e) {
    artifactError.value = e.message
  } finally {
    uploadLoading.value = false
  }
}

function insertArtifactPath(artifact) {
  const placeholder = /artifacts=\/[^\s]*/
  if (placeholder.test(command.value)) {
    command.value = command.value.replace(placeholder, `artifacts=${artifact.path}`)
  } else {
    command.value += ` artifacts=${artifact.path}`
  }
  selectedPreset.value = 'custom'
}

/* ── Copy command ───────────────────────────────────────────────── */

async function copyCommand() {
  try { await navigator.clipboard.writeText(command.value) } catch (_) {}
}

/* ── Lifecycle ──────────────────────────────────────────────────── */

connectWs()

onUnmounted(() => {
  mounted = false
  if (ws) { try { ws.close() } catch (_) {} ws = null }
})

defineExpose({ run, stop, isRunning })
</script>

<style scoped>
.gst-panel {
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

.ti-expansion {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
  border-radius: 12px !important;
}
.exp-title { font-size: 12.5px; font-weight: 700; min-height: 48px !important; }

.card-ttl     { font-size: 12.5px; font-weight: 700; color: rgb(var(--v-theme-on-surface)); }
.card-ttl-row { display: flex; align-items: center; justify-content: space-between; }

/* ── Presets ── */
.preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.preset-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 1px solid rgba(var(--v-border-color),var(--v-border-opacity));
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.12s;
  user-select: none;
}
.preset-chip:hover { border-color: #4da6ff; color: #4da6ff; }
.preset-chip.active { color: rgb(var(--v-theme-on-surface)); font-weight: 600; }

/* ── Command textarea ── */
.cmd-textarea {
  width: 100%;
  background: rgb(var(--v-theme-background));
  border: 1px solid rgba(var(--v-border-color),var(--v-border-opacity));
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  padding: 10px 12px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition: border-color 0.12s;
}
.cmd-textarea:focus { border-color: #4da6ff; }
.cmd-textarea:disabled { opacity: 0.5; cursor: not-allowed; }
.cmd-hint { font-size: 11px; color: #64748b; display: flex; align-items: center; }
.cmd-hint code { background: rgba(77,166,255,0.1); color: #4da6ff; padding: 1px 4px; border-radius: 3px; font-size: 11px; margin: 0 2px; }

/* ── Artifacts ── */
.artifact-path-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.artifact-path { font-size: 11px; color: #64748b; }
.artifact-toolbar { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.no-artifacts { font-size: 12px; color: #475569; text-align: center; padding: 12px 0; }
.artifact-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--v-border-color),var(--v-border-opacity));
  border-radius: 8px;
  margin-bottom: 6px;
  background: rgb(var(--v-theme-background));
}
.artifact-info { display: flex; flex-direction: column; flex: 0 0 100px; min-width: 0; }
.artifact-name { font-size: 13px; font-weight: 600; color: rgb(var(--v-theme-on-surface)); }
.artifact-meta { font-size: 11px; color: #64748b; }
.artifact-chips { display: flex; flex-wrap: wrap; flex: 1; min-width: 0; align-items: center; }
.artifact-more  { font-size: 11px; color: #64748b; }

/* ── Status ── */
.status-row      { display: flex; align-items: center; gap: 10px; }
.status-dot-wrap { display: flex; align-items: center; gap: 6px; }
.status-dot      { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-running { background: #4da6ff; box-shadow: 0 0 8px #4da6ff; animation: pulse 1.2s infinite; }
.dot-error   { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
.dot-idle    { background: #475569; }
.status-lbl  { font-size: 13px; }
.status-bars { display: none; align-items: flex-end; gap: 2px; height: 16px; }
.status-bars.active { display: inline-flex; }
.status-bars span { display: inline-block; width: 3px; border-radius: 1px; height: 3px; background: #4da6ff; animation: bar-rise 0.7s ease-in-out infinite; }

/* ── Log ── */
.log-card { display: flex; flex-direction: column; gap: 0; min-height: 220px; flex: 1; overflow: hidden; padding: 0 !important; }
.log-hdr  { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 8px; border-bottom: 1px solid rgba(var(--v-border-color),var(--v-border-opacity)); flex-shrink: 0; }
.log-ttl  { font-size: 12.5px; font-weight: 700; color: rgb(var(--v-theme-on-surface)); }
.log-count { font-size: 11px; color: #64748b; background: rgb(var(--v-theme-surface-variant)); padding: 2px 8px; border-radius: 10px; }
.log-body { flex: 1; overflow-y: auto; padding: 8px 14px; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 11.5px; line-height: 1.55; background: rgb(var(--v-theme-background)); }
.log-empty { color: #475569; font-size: 12px; text-align: center; padding: 20px 0; font-family: inherit; }
.log-line  { display: flex; gap: 10px; margin-bottom: 2px; }
.log-ts    { color: #475569; flex-shrink: 0; font-size: 10.5px; padding-top: 1px; }
.log-stdout { color: rgb(var(--v-theme-on-surface)); }
.log-stderr { color: #fbbf24; }
.log-meta   { color: #4da6ff; }

@keyframes bar-rise { 0%,100%{height:3px} 50%{height:14px} }
@keyframes pulse    { 0%,100%{opacity:1}  50%{opacity:0.5} }
</style>
