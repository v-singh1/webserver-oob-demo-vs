<template>
  <div class="logs-page">

    <!-- Page header -->
    <div class="page-hdr">
      <div class="ph-left">
        <div class="ph-icon">
          <v-icon size="22" color="blue-lighten-2">mdi-file-document-outline</v-icon>
        </div>
        <div>
          <div class="ph-title">System Logs</div>
          <div class="ph-sub">Journal entries from the webserver-oob service — auto-refreshes every 10 s</div>
        </div>
      </div>
      <div class="ph-actions">
        <span class="entry-count">{{ lines.length }} entries</span>
        <v-btn
          size="small" variant="outlined"
          prepend-icon="mdi-download"
          :disabled="lines.length === 0"
          @click="saveToFile"
        >Save to File</v-btn>
        <v-btn
          size="small" variant="outlined"
          :prepend-icon="autoRefresh ? 'mdi-pause' : 'mdi-play'"
          @click="autoRefresh = !autoRefresh"
        >{{ autoRefresh ? 'Pause' : 'Resume' }}</v-btn>
        <v-btn
          size="small" variant="outlined"
          prepend-icon="mdi-refresh"
          :loading="loading"
          @click="fetchLogs"
        >Refresh</v-btn>
      </div>
    </div>

    <!-- Toolbar: filter + line count -->
    <div class="toolbar">
      <div class="search-wrap">
        <v-icon size="15" color="#64748b" style="position:absolute;left:10px;top:50%;transform:translateY(-50%)">mdi-magnify</v-icon>
        <input
          v-model="filter"
          class="search-input"
          type="text"
          placeholder="Filter log lines…"
        />
        <button v-if="filter" class="search-clear" @click="filter = ''">
          <v-icon size="13">mdi-close</v-icon>
        </button>
      </div>

      <div class="line-count-wrap">
        <label class="field-lbl">Lines</label>
        <select v-model="lineCount" class="line-select" @change="fetchLogs">
          <option :value="80">80</option>
          <option :value="200">200</option>
          <option :value="500">500 (max)</option>
        </select>
      </div>

      <div class="refresh-indicator" :class="{ pulse: loading }">
        <v-icon size="12">mdi-clock-outline</v-icon>
        {{ nextRefreshSec }}s
      </div>
    </div>

    <!-- Log panel -->
    <div class="log-panel">
      <div v-if="error" class="log-error">
        <v-icon size="14" color="error">mdi-alert-circle</v-icon>
        {{ error }}
      </div>
      <div v-else-if="loading && lines.length === 0" class="log-placeholder">
        Loading…
      </div>
      <div v-else-if="filteredLines.length === 0" class="log-placeholder">
        {{ filter ? 'No lines match the filter.' : 'No log entries.' }}
      </div>
      <div v-else ref="logEl" class="log-lines">
        <div
          v-for="(line, i) in filteredLines"
          :key="i"
          class="log-line"
          :class="lineClass(line)"
        >{{ line }}</div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const lines      = ref([])
const loading    = ref(false)
const error      = ref('')
const filter     = ref('')
const lineCount  = ref(80)
const autoRefresh = ref(true)
const nextRefreshSec = ref(10)

let refreshTimer = null
let countdownTimer = null

const filteredLines = computed(() => {
  if (!filter.value.trim()) return lines.value
  const q = filter.value.toLowerCase()
  return lines.value.filter(l => l.toLowerCase().includes(q))
})

function lineClass(line) {
  if (/error/i.test(line))   return 'line-error'
  if (/warn/i.test(line))    return 'line-warn'
  if (/crit|fatal/i.test(line)) return 'line-crit'
  return ''
}

async function fetchLogs() {
  loading.value = true
  error.value   = ''
  try {
    const r = await fetch(`/logs?n=${Math.min(lineCount.value, 500)}`)
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const d = await r.json()
    lines.value = d.lines || []
  } catch (e) {
    error.value = 'Could not retrieve logs: ' + e.message
  } finally {
    loading.value = false
  }
  nextRefreshSec.value = 10
}

function startTimers() {
  clearTimers()
  refreshTimer   = setInterval(() => { if (autoRefresh.value) fetchLogs() }, 10000)
  countdownTimer = setInterval(() => {
    if (!autoRefresh.value) return
    nextRefreshSec.value = Math.max(0, nextRefreshSec.value - 1)
  }, 1000)
}

function clearTimers() {
  clearInterval(refreshTimer)
  clearInterval(countdownTimer)
}

watch(autoRefresh, v => { if (v) fetchLogs() })

function saveToFile() {
  if (!lines.value.length) return
  const content = lines.value.slice().reverse().join('\n')
  const blob = new Blob([content], { type: 'text/plain' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'webserver-oob-logs-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.txt'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => { fetchLogs(); startTimers() })
onUnmounted(clearTimers)
</script>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 16px;
  overflow: hidden;
}

/* Page header */
.page-hdr    { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; flex-wrap:wrap; }
.ph-left     { display:flex; align-items:center; gap:14px; }
.ph-icon     { width:50px; height:50px; border-radius:50%; flex-shrink:0; background:radial-gradient(circle at 40% 40%,#1a3a7a,#0a1540); border:2px solid #1d4ed8; display:flex; align-items:center; justify-content:center; }
.ph-title    { font-size:21px; font-weight:800; color:rgb(var(--v-theme-on-surface)); margin-bottom:3px; }
.ph-sub      { font-size:13px; color:#64748b; }
.ph-actions  { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.entry-count { font-size:12px; color:#64748b; background:rgb(var(--v-theme-surface-variant)); padding:4px 10px; border-radius:10px; white-space:nowrap; }

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.search-wrap  { position:relative; flex:1; min-width:180px; }
.search-input {
  width: 100%; background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color),var(--v-border-opacity));
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px; padding: 7px 30px 7px 32px;
  border-radius: 7px; outline: none; box-sizing: border-box;
}
.search-input:focus { border-color: #4da6ff; }
.search-clear { position:absolute; right:8px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:#64748b; display:flex; align-items:center; }

.field-lbl    { font-size:11px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:1px; white-space:nowrap; }
.line-count-wrap { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.line-select  {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color),var(--v-border-opacity));
  color: rgb(var(--v-theme-on-surface));
  font-size: 12px; padding: 6px 8px; border-radius: 6px; outline: none; cursor: pointer;
}

.refresh-indicator { display:flex; align-items:center; gap:5px; font-size:12px; color:#475569; flex-shrink:0; transition:opacity 0.3s; }
.refresh-indicator.pulse { color:#4da6ff; }

/* Log panel */
.log-panel {
  flex: 1;
  min-height: 0;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color),var(--v-border-opacity));
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.log-placeholder {
  flex: 1; display:flex; align-items:center; justify-content:center;
  font-size: 13px; color: #475569;
}
.log-error {
  display: flex; align-items: center; gap: 7px;
  padding: 14px 16px; font-size: 13px; color: #f87171;
}

.log-lines {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 11.5px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.log-line {
  padding: 2px 0;
  border-bottom: 1px solid rgba(var(--v-border-color),calc(var(--v-border-opacity) * 0.5));
  color: #94a3b8;
  word-break: break-all;
  line-height: 1.5;
  white-space: pre-wrap;
}
.log-line.line-error { color: #f87171; }
.log-line.line-crit  { color: #fb923c; }
.log-line.line-warn  { color: #fbbf24; }
</style>
