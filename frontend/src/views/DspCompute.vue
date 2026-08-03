<template>
  <div class="dsp-page">

    <!-- Page Header -->
    <div class="page-hdr">
      <div class="ph-left">
        <div class="ph-icon"><v-icon size="22">mdi-chart-bar</v-icon></div>
        <div>
          <div class="ph-title">DSP Compute</div>
          <div class="ph-sub">High-performance C7x DSP compute demos — Linux-to-C7x workload offload via RPMsg-DMA.</div>
        </div>
      </div>
      <v-btn
        :color="topRunning ? 'error' : 'warning'"
        variant="flat"
        size="small"
        :disabled="topDisabled"
        :prepend-icon="topRunning ? 'mdi-stop' : 'mdi-play'"
        @click="triggerRun"
      >{{ topRunning ? 'Stop Demo' : 'Run Demo' }}</v-btn>
    </div>

    <!-- 2-column grid -->
    <div class="content-grid">

      <!-- COL 1: Demo Selector -->
      <div class="card">
        <div class="card-ttl">Demo Selection</div>
        <div
          v-for="(demo, i) in demoList" :key="i"
          class="dsi" :class="{ active: activeDemo === i }"
          @click="selectDemo(i)"
        >
          <div class="dsi-ic" :style="{ background: demo.icBg, border: `2px solid ${demo.icBd}`, color: demo.icColor }">
            <v-icon size="16">{{ demo.icon }}</v-icon>
          </div>
          <div class="dsi-txt">
            <div class="dsi-name">{{ demo.name }}</div>
            <div class="dsi-sub">{{ demo.sub }}</div>
          </div>
          <span class="dsi-arr">›</span>
        </div>
      </div>

      <!-- Controls + Visualization -->
      <div class="demo-panel">

      <!-- COL 2: Controls -->
      <div class="card ctrl-card">
        <div class="card-ttl">Demo Description</div>

        <!-- ── Audio DSP Offload ── -->
        <template v-if="activeDemo === 0">
          <p class="desc-text">Real-time 8-channel audio processing offloaded to C7x DSP via RPMsg-DMA. FFT bandpass filtering with input/output spectrum visualization and live CPU/DSP performance metrics.</p>
          <hr class="card-div">
          <div class="status-row">
            <span class="status-dot" :style="{ background: ao.statusColor, animation: ao.statusPulse ? 'pulse 2s infinite' : 'none' }"/>
            <span style="font-size:12px" :style="{ color: ao.statusColor }">{{ ao.statusMsg }}</span>
          </div>
          <div class="sub-ttl">Controls</div>
          <div class="filter-row">
            <span class="filter-lbl">Filter</span>
            <button class="filt-btn" :class="{ active: ao.filterOn }"  @click="setAoFilter(true)">ON</button>
            <button class="filt-btn" :class="{ active: !ao.filterOn }" @click="setAoFilter(false)">OFF</button>
          </div>
          <div class="sub-ttl">Live Metrics</div>
          <div class="metrics-grid">
            <div class="metric-tile">
              <div class="mt-lbl">Frame</div>
              <div class="mt-val">{{ ao.frame }}</div>
            </div>
            <div class="metric-tile">
              <div class="mt-lbl">Latency</div>
              <div class="mt-val">{{ ao.latency }}</div>
              <div class="mt-stats"><span>Min <span class="sv">{{ ao.latMin }}</span></span><span class="sep">|</span><span>Avg <span class="sv">{{ ao.latAvg }}</span></span><span class="sep">|</span><span>Max <span class="sv">{{ ao.latMax }}</span></span></div>
            </div>
            <div class="metric-tile">
              <div class="mt-lbl">CPU Load</div>
              <div class="mt-val" style="color:#60a5fa">{{ ao.cpu }}</div>
              <div class="mt-stats"><span>Min <span class="sv">{{ ao.cpuMin }}</span></span><span class="sep">|</span><span>Avg <span class="sv">{{ ao.cpuAvg }}</span></span><span class="sep">|</span><span>Max <span class="sv">{{ ao.cpuMax }}</span></span></div>
            </div>
            <div class="metric-tile">
              <div class="mt-lbl">DSP Load</div>
              <div class="mt-val" style="color:#fbbf24">{{ ao.dsp }}</div>
              <div class="mt-stats"><span>Min <span class="sv">{{ ao.dspMin }}</span></span><span class="sep">|</span><span>Avg <span class="sv">{{ ao.dspAvg }}</span></span><span class="sep">|</span><span>Max <span class="sv">{{ ao.dspMax }}</span></span></div>
            </div>
          </div>
          <hr class="card-div">
          <div class="sub-ttl">Features</div>
          <ul class="feat-list">
            <li v-for="f in aoFeatures" :key="f"><span style="color:#fbbf24">✓</span> {{ f }}</li>
          </ul>
          <div v-if="conflictActive[0]" class="conflict-banner">
            <div class="banner-hdr"><v-icon size="15" color="error">mdi-alert-triangle</v-icon><span style="font-size:12px;font-weight:700;color:#fca5a5">Biquad Overlay Conflict</span></div>
            <p class="banner-body">The DSP audio overlay (<code>k3-am62d2-evm-dsp-controlled-audio.dtbo</code>) is active. Remove it to run this demo.</p>
            <button class="rem-btn" @click="removeAndReboot"><v-icon size="12">mdi-close</v-icon> Remove Overlay &amp; Reboot</button>
          </div>
        </template>

        <!-- ── 2D FFT ── -->
        <template v-else-if="activeDemo === 1">
          <p class="desc-text">Offloads 128×128×2 test data for 2D FFT processing to C7x DSP via RPMsg-DMA, then compares output against reference data to verify correctness.</p>
          <hr class="card-div">
          <div class="status-row">
            <span class="status-dot" :style="{ background: fft2d.statusColor, animation: fft2d.statusPulse ? 'pulse 2s infinite' : 'none' }"/>
            <span style="font-size:12px" :style="{ color: fft2d.statusColor }">{{ fft2d.statusMsg }}</span>
          </div>
          <div class="sub-ttl">Execution Info</div>
          <div class="metrics-grid">
            <div class="metric-tile">
              <div class="mt-lbl">Result</div>
              <div class="mt-val" :style="{ color: fft2d.resultColor }">{{ fft2d.result }}</div>
            </div>
            <div class="metric-tile">
              <div class="mt-lbl">Elapsed</div>
              <div class="mt-val" style="color:#22d3ee">{{ fft2d.elapsed }}</div>
            </div>
          </div>
          <hr class="card-div">
          <div class="sub-ttl">Features</div>
          <ul class="feat-list">
            <li v-for="f in fft2dFeatures" :key="f"><span style="color:#22d3ee">✓</span> {{ f }}</li>
          </ul>
          <div v-if="conflictActive[1]" class="conflict-banner">
            <div class="banner-hdr"><v-icon size="15" color="error">mdi-alert-triangle</v-icon><span style="font-size:12px;font-weight:700;color:#fca5a5">Biquad Overlay Conflict</span></div>
            <p class="banner-body">The DSP audio overlay (<code>k3-am62d2-evm-dsp-controlled-audio.dtbo</code>) is active. Remove it to run this demo.</p>
            <button class="rem-btn" @click="removeAndReboot"><v-icon size="12">mdi-close</v-icon> Remove Overlay &amp; Reboot</button>
          </div>
        </template>

        <!-- ── Sigchain Biquad ── -->
        <template v-else>
          <p class="desc-text">Real-time 3-stage parametric equalizer (biquad cascade) on C7x DSP with live C7x load, cycles and throughput monitoring via multi-port TCP server.</p>
          <hr class="card-div">
          <div class="status-row">
            <span class="status-dot" :style="{ background: biquad.statusColor, animation: biquad.statusPulse ? 'pulse 2s infinite' : 'none' }"/>
            <span style="font-size:12px" :style="{ color: biquad.statusColor }">{{ biquad.statusMsg }}</span>
          </div>
          <div v-if="biquadOverlayWarn" class="warn-banner">
            <div class="banner-hdr"><v-icon size="15" color="warning">mdi-alert-triangle</v-icon><span style="font-size:12px;font-weight:700;color:#fbbf24">DSP Audio Overlay Required</span></div>
            <p class="banner-body">This demo requires the DSP-controlled audio overlay in <code>uEnv.txt</code>. Add:</p>
            <code class="overlay-code">name_overlays=ti/k3-am62d2-evm-dsp-controlled-audio.dtbo</code>
            <p style="font-size:11px;color:#64748b;margin-top:2px">File: <code style="color:#94a3b8">/run/media/boot-mmcblk1p1/uEnv.txt</code></p>
            <button class="apply-btn" @click="applyBiquadOverlay"><v-icon size="12">mdi-check</v-icon> Apply Overlay &amp; Reboot</button>
          </div>
          <div v-else-if="biquad.overlayActive" class="overlay-ok">
            <v-icon size="13" color="success">mdi-check-circle</v-icon>
            <span style="font-size:11px;color:#22c55e">DSP audio overlay active</span>
          </div>
          <div class="sub-ttl">Live Metrics</div>
          <div class="metrics-grid">
            <div class="metric-tile">
              <div class="mt-lbl">C7x Load</div>
              <div class="mt-val" style="color:#3b82f6">{{ biquad.load }}</div>
              <div class="mt-stats"><span>Min <span class="sv">{{ biquad.loadMin }}</span></span><span class="sep">|</span><span>Avg <span class="sv">{{ biquad.loadAvg }}</span></span><span class="sep">|</span><span>Max <span class="sv">{{ biquad.loadMax }}</span></span></div>
            </div>
            <div class="metric-tile">
              <div class="mt-lbl">Cycles</div>
              <div class="mt-val">{{ biquad.cycles }}</div>
            </div>
            <div class="metric-tile">
              <div class="mt-lbl">Throughput</div>
              <div class="mt-val" style="color:#22c55e">{{ biquad.tput }}</div>
            </div>
          </div>
          <hr class="card-div">
          <div class="sub-ttl">Features</div>
          <ul class="feat-list">
            <li v-for="f in biquadFeatures" :key="f"><span style="color:#c084fc">✓</span> {{ f }}</li>
          </ul>
        </template>
      </div>

      <!-- Visualization -->
      <div class="card viz-card">
        <div class="card-ttl">Live Visualization</div>

        <!-- Audio Offload canvases -->
        <template v-if="activeDemo === 0">
          <div class="canvas-wrap">
            <div class="canvas-lbl" style="color:#34d399">Input Audio Spectrum</div>
            <canvas ref="specInCanvas" width="600" height="150" class="viz-canvas"/>
          </div>
          <div class="canvas-wrap">
            <div class="canvas-lbl" style="color:#60a5fa">Output Audio Spectrum</div>
            <canvas ref="specOutCanvas" width="600" height="150" class="viz-canvas"/>
          </div>
          <hr class="card-div">
          <div class="canvas-wrap">
            <div class="canvas-lbl">Average Amplitude</div>
            <canvas ref="tsAmpCanvas" width="600" height="100" class="viz-canvas"/>
          </div>
          <div class="canvas-wrap">
            <div class="canvas-lbl">Frame Latency (ms)</div>
            <canvas ref="tsLatCanvas" width="600" height="100" class="viz-canvas"/>
          </div>
          <div class="canvas-wrap">
            <div class="canvas-lbl">System Load</div>
            <canvas ref="tsLoadCanvas" width="600" height="100" class="viz-canvas"/>
          </div>
        </template>

        <!-- 2D FFT viz -->
        <template v-else-if="activeDemo === 1">
          <div class="fft-header">
            <div style="font-size:10.5px;color:#475569;font-family:monospace;margin-bottom:6px">RPMsg based 2D FFT Offload Example</div>
            <div style="display:flex;align-items:center;gap:10px">
              <span :style="{ fontSize:'14px', fontWeight:700, color: fft2d.badgeColor }">{{ fft2d.badge }}</span>
              <span style="flex:1"/>
              <span style="font-size:11px;color:#475569">Elapsed:</span>
              <span style="font-size:13px;font-weight:700;color:#22d3ee">{{ fft2d.elapsed }}</span>
            </div>
          </div>
          <div class="fft-metrics">
            <div class="metric-tile">
              <div class="mt-lbl">C7x Load</div>
              <div class="mt-val" style="color:#3b82f6">{{ fft2d.load }}</div>
              <div class="mt-stats"><span>Min <span class="sv">{{ fft2d.loadMin }}</span></span><span class="sep">|</span><span>Avg <span class="sv">{{ fft2d.loadAvg }}</span></span><span class="sep">|</span><span>Max <span class="sv">{{ fft2d.loadMax }}</span></span></div>
            </div>
            <div class="metric-tile">
              <div class="mt-lbl">Cycle Count</div>
              <div class="mt-val">{{ fft2d.cycles }}</div>
            </div>
            <div class="metric-tile">
              <div class="mt-lbl">DDR Throughput</div>
              <div class="mt-val" style="color:#22d3ee">{{ fft2d.ddr }}</div>
              <div class="mt-stats"><span>Min <span class="sv">{{ fft2d.ddrMin }}</span></span><span class="sep">|</span><span>Avg <span class="sv">{{ fft2d.ddrAvg }}</span></span><span class="sep">|</span><span>Max <span class="sv">{{ fft2d.ddrMax }}</span></span></div>
            </div>
          </div>
          <hr class="card-div">
          <div class="canvas-lbl">Console Output</div>
          <div ref="fft2dLogEl" class="log-box" style="height:300px"/>
        </template>

        <!-- Biquad viz -->
        <template v-else>
          <div class="canvas-wrap">
            <div class="canvas-lbl" style="color:#3b82f6">{{ biquad.loadLbl }}</div>
            <canvas ref="bqLoadCanvas" width="600" height="80" class="viz-canvas"/>
          </div>
          <div class="canvas-wrap">
            <div class="canvas-lbl" style="color:#ef4444">{{ biquad.cyclesLbl }}</div>
            <canvas ref="bqCyclesCanvas" width="600" height="80" class="viz-canvas"/>
          </div>
          <div class="canvas-wrap">
            <div class="canvas-lbl" style="color:#22c55e">{{ biquad.tputLbl }}</div>
            <canvas ref="bqTputCanvas" width="600" height="80" class="viz-canvas"/>
          </div>
          <hr class="card-div">
          <div class="canvas-lbl">Board Logs (Port 8888)</div>
          <div ref="biquadLogEl" class="log-box" style="height:160px"/>
        </template>
      </div>
      </div>
    </div>

    <!-- Reboot overlay -->
    <div v-if="rebootMsg" class="reboot-overlay">
      <div class="reboot-box">
        <v-icon size="28" color="warning">mdi-refresh</v-icon>
        <div class="reboot-title">Board Rebooting</div>
        <div class="reboot-msg">{{ rebootMsg }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

// ── Demo list ──────────────────────────────────────────────────────────
const demoList = [
  { name: 'Audio DSP Offload',  sub: '8-ch RPMsg-DMA on C7x DSP',        icon: 'mdi-chart-bar', icBg: 'radial-gradient(circle at 40% 40%,#3a1a00,#1f0d00)', icBd: '#d97706', icColor: '#fbbf24' },
  { name: '2D FFT Offload',     sub: '128×128 on C7x via RPMsg-DMA',      icon: 'mdi-grid',      icBg: 'radial-gradient(circle at 40% 40%,#04201e,#021210)', icBd: '#0891b2', icColor: '#22d3ee' },
  { name: 'Sigchain Biquad EQ', sub: '3-stage parametric EQ on C7x DSP',  icon: 'mdi-pulse',     icBg: 'radial-gradient(circle at 40% 40%,#1e0d40,#0d0620)', icBd: '#7c3aed', icColor: '#c084fc' },
]
const aoFeatures     = ['8-channel audio via RPMsg-DMA','FFT bandpass filtering on C7x DSP','Real-time input/output spectrum','Live CPU and DSP load metrics','ARM vs DSP mode comparison']
const fft2dFeatures  = ['128×128×2 offload on C7x DSP','RPMsg-DMA zero-copy data transfer','Pass/fail vs. reference output','2D FFT magnitude heatmap']
const biquadFeatures = ['3-stage cascade biquad EQ on C7x DSP','TAD5212 DAC + PCM6240 ADC support','Live C7x load, cycles, throughput','Multi-port TCP (logs, cmds, stats)']

// ── Global state ───────────────────────────────────────────────────────
const activeDemo   = ref(0)
const conflictActive = reactive([false, false, false])
const rebootMsg    = ref('')
const biquadOverlayWarn = ref(false)

// Audio Offload
const ao = reactive({
  running: false,
  statusMsg: 'Not running', statusColor: '#64748b', statusPulse: false,
  filterOn: true,
  frame: '--',
  latency: '-- ms', latMin: '--', latAvg: '--', latMax: '--',
  cpu: '--%',       cpuMin: '--', cpuAvg: '--', cpuMax: '--',
  dsp: '--%',       dspMin: '--', dspAvg: '--', dspMax: '--',
})
let aoWs = null, aoStats = null

// 2D FFT
const fft2d = reactive({
  running: false,
  statusMsg: 'Not running', statusColor: '#64748b', statusPulse: false,
  result: '--', resultColor: '#e2e8f0',
  elapsed: '-- ms',
  badge: 'Idle', badgeColor: '#64748b',
  load: '--%',  loadMin: '--', loadAvg: '--', loadMax: '--',
  cycles: '--',
  ddr: '-- MB/s', ddrMin: '--', ddrAvg: '--', ddrMax: '--',
})
let fft2dWs = null
let fft2dStats = { load: null, ddr: null }
const fft2dLogEl = ref(null)

// Biquad
const biquad = reactive({
  running: false, overlayActive: false,
  statusMsg: 'Not running', statusColor: '#64748b', statusPulse: false,
  load: '--%', loadMin: '--', loadAvg: '--', loadMax: '--',
  cycles: '--',
  tput: '-- MB/s',
  loadLbl: 'C7x DSP Load (%)',
  cyclesLbl: 'DSP Processing Cycles',
  tputLbl: 'Demo Throughput (MB/s)',
})
let biquadWs = null, biquadStats = null
const biquadLogEl = ref(null)

// Canvas refs
const specInCanvas  = ref(null), specOutCanvas = ref(null)
const tsAmpCanvas   = ref(null), tsLatCanvas   = ref(null), tsLoadCanvas = ref(null)
const bqLoadCanvas  = ref(null), bqCyclesCanvas = ref(null), bqTputCanvas = ref(null)

// ── Computed ───────────────────────────────────────────────────────────
const topRunning = computed(() =>
  activeDemo.value === 0 ? ao.running : activeDemo.value === 1 ? fft2d.running : biquad.running
)
const topDisabled = computed(() => {
  if (activeDemo.value === 2) return !biquad.overlayActive && !biquad.running
  return conflictActive[activeDemo.value] && !topRunning.value
})

// ── Helpers ────────────────────────────────────────────────────────────
function _accum(s, v) {
  if (v == null || isNaN(v)) return s
  if (!s) return { min: v, max: v, sum: v, n: 1 }
  return { min: Math.min(s.min, v), max: Math.max(s.max, v), sum: s.sum + v, n: s.n + 1 }
}
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ── Demo selection ─────────────────────────────────────────────────────
function selectDemo(i) {
  if (i === activeDemo.value) return
  if (i !== 0 && ao.running)     stopAo()
  if (i !== 1 && fft2d.running)  stopFft2d()
  if (i !== 2 && biquad.running) stopBiquad()
  activeDemo.value = i
  nextTick(() => {
    if (i === 0 || i === 1) checkConflictOverlay(i)
    else if (i === 2) checkBiquadOverlay()
    if (i === 0) clearAoCanvases()
  })
}
function triggerRun() {
  if (activeDemo.value === 0) toggleAo()
  else if (activeDemo.value === 1) toggleFft2d()
  else toggleBiquad()
}

// ── Overlay checks ─────────────────────────────────────────────────────
function checkConflictOverlay(demoIdx) {
  fetch('/sigchain-biquad/check-overlay', { signal: AbortSignal.timeout(5000) })
    .then(r => r.json())
    .then(d => { if (d) conflictActive[demoIdx] = !!d.active })
    .catch(() => {})
}

function checkBiquadOverlay() {
  biquad.statusMsg = 'Checking overlay…'; biquad.statusColor = '#64748b'; biquad.statusPulse = false
  fetch('/sigchain-biquad/check-overlay', { signal: AbortSignal.timeout(5000) })
    .then(r => r.json())
    .then(d => {
      if (!d) return
      biquad.overlayActive = !!d.active
      if (d.active) {
        biquadOverlayWarn.value = false
        biquad.statusMsg = 'Ready'; biquad.statusColor = '#22c55e'
      } else {
        biquadOverlayWarn.value = true
        biquad.statusMsg = 'Overlay not set — demo disabled'; biquad.statusColor = '#d97706'
      }
    })
    .catch(() => {
      biquadOverlayWarn.value = false
      biquad.statusMsg = 'Could not read uEnv.txt'; biquad.statusColor = '#ef4444'
    })
}

function removeAndReboot() {
  rebootMsg.value = 'Removing overlay…'
  fetch('/sigchain-biquad/disable-overlay', { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (d.success) { rebootMsg.value = 'Board rebooting — page will refresh when device comes back online.'; startRebootWatch() }
      else rebootMsg.value = ''
    })
    .catch(() => { rebootMsg.value = '' })
}

function applyBiquadOverlay() {
  biquad.statusMsg = 'Writing overlay and rebooting…'; biquad.statusColor = '#f59e0b'; biquad.statusPulse = true
  fetch('/sigchain-biquad/enable-overlay', { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (d.success) { rebootMsg.value = 'Board rebooting — page will refresh when device comes back online.'; startRebootWatch() }
      else { biquad.statusMsg = 'Failed: ' + (d.error || 'unknown'); biquad.statusColor = '#ef4444'; biquad.statusPulse = false }
    })
    .catch(e => { biquad.statusMsg = 'Error: ' + e.message; biquad.statusColor = '#ef4444'; biquad.statusPulse = false })
}

let _rebootWs = null
function startRebootWatch() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  function tryConnect() {
    if (_rebootWs) { try { _rebootWs.close() } catch (_) {} }
    _rebootWs = new WebSocket(`${proto}//${location.host}/health`)
    _rebootWs.onopen  = () => location.reload()
    _rebootWs.onclose = () => setTimeout(tryConnect, 3000)
    _rebootWs.onerror = () => {}
  }
  setTimeout(tryConnect, 3000)
}

// ── Audio DSP Offload ──────────────────────────────────────────────────
function toggleAo() { if (ao.running) stopAo(); else startAo() }

async function startAo() {
  if (conflictActive[0]) { checkConflictOverlay(0); return }
  ao.running = true
  aoStats = { lat: null, cpu: null, dsp: null }
  ao.latMin=ao.latAvg=ao.latMax='--'; ao.cpuMin=ao.cpuAvg=ao.cpuMax='--'; ao.dspMin=ao.dspAvg=ao.dspMax='--'
  ao.statusMsg = 'Starting rpmsg_audio_offload_example…'; ao.statusColor = '#f59e0b'; ao.statusPulse = true

  await nextTick()
  clearAoCanvases()

  fetch('/audio-offload/run')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status) })
    .then(() => { ao.statusMsg = 'Connecting…'; connectAoWs() })
    .catch(err => { ao.statusMsg = 'Error: ' + err.message; ao.statusColor = '#ef4444'; ao.statusPulse = false; ao.running = false })
}

function stopAo() {
  fetch('/audio-offload/stop').catch(() => {})
  ao.running = false
  if (aoWs) { try { aoWs.close() } catch (_) {} aoWs = null }
  ao.statusMsg = 'Stopped'; ao.statusColor = '#64748b'; ao.statusPulse = false
  aoTsAmp.fill(0); aoTsLat.fill(0); aoTsCpu.fill(0); aoTsDsp.fill(0)
  aoTsIdx = 0; aoTsCount = 0
  clearAoCanvases()
}

function connectAoWs() {
  if (aoWs && (aoWs.readyState === 0 || aoWs.readyState === 1)) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  aoWs = new WebSocket(`${proto}//${location.host}/audio-offload`)
  aoWs.onmessage = e => {
    try {
      const d = JSON.parse(e.data)
      if (d.type === 'status') {
        const c = d.state === 'connected' ? '#22c55e' : d.state === 'connecting' ? '#f59e0b' : '#64748b'
        ao.statusMsg = d.message; ao.statusColor = c; ao.statusPulse = d.state === 'connecting'
      } else if (d.type === 'audio') {
        drawAoSpectrum(d.channel === 'input' ? 'in' : 'out', d.pcm)
      } else if (d.type === 'metrics') {
        const lat = d.latency ?? 0, cpu = d.cpuLoad ?? 0, dsp = d.dspLoad ?? 0, amp = d.avgAmp ?? 0
        ao.frame   = d.frame   != null ? String(d.frame) : '--'
        ao.latency = lat ? lat.toFixed(2) + ' ms' : '-- ms'
        ao.cpu     = cpu ? cpu.toFixed(1) + '%'   : '--%'
        ao.dsp     = dsp ? dsp.toFixed(1) + '%'   : '--%'
        if (aoStats) {
          if (d.latency != null) { aoStats.lat = _accum(aoStats.lat, lat); const s=aoStats.lat; ao.latMin=s.min.toFixed(2)+' ms'; ao.latAvg=(s.sum/s.n).toFixed(2)+' ms'; ao.latMax=s.max.toFixed(2)+' ms' }
          if (d.cpuLoad != null) { aoStats.cpu = _accum(aoStats.cpu, cpu); const s=aoStats.cpu; ao.cpuMin=s.min.toFixed(1)+'%'; ao.cpuAvg=(s.sum/s.n).toFixed(1)+'%'; ao.cpuMax=s.max.toFixed(1)+'%' }
          if (d.dspLoad != null) { aoStats.dsp = _accum(aoStats.dsp, dsp); const s=aoStats.dsp; ao.dspMin=s.min.toFixed(1)+'%'; ao.dspAvg=(s.sum/s.n).toFixed(1)+'%'; ao.dspMax=s.max.toFixed(1)+'%' }
        }
        aoTsPush(amp, lat, cpu, dsp)
        drawTrendLine(tsAmpCanvas.value,  aoTsAmp, aoTsIdx, aoTsCount, AO_TS_LEN, '#22d3ee', '')
        drawTrendLine(tsLatCanvas.value,  aoTsLat, aoTsIdx, aoTsCount, AO_TS_LEN, '#22c55e', 'ms')
        drawAoLoadChart()
      }
    } catch (err) { console.warn('[ao-ws]', err) }
  }
  aoWs.onclose = () => { if (ao.running) { ao.statusMsg = 'Connection lost'; ao.statusColor = '#ef4444'; ao.statusPulse = false } }
  aoWs.onerror = () => {}
}

function setAoFilter(enable) {
  ao.filterOn = enable
  if (aoWs && aoWs.readyState === 1) aoWs.send(JSON.stringify({ type: 'set_filter', value: enable ? 1 : 0 }))
}

// ── Audio Offload Visualization ────────────────────────────────────────
const AO_TS_LEN = 600
const aoTsAmp = new Float32Array(AO_TS_LEN), aoTsLat = new Float32Array(AO_TS_LEN)
const aoTsCpu = new Float32Array(AO_TS_LEN), aoTsDsp = new Float32Array(AO_TS_LEN)
let aoTsIdx = 0, aoTsCount = 0
const aoSpecLastDraw = {}
const aoSpecFFTRe = new Float64Array(512), aoSpecFFTIm = new Float64Array(512)

function aoTsPush(amp, lat, cpu, dsp) {
  aoTsAmp[aoTsIdx]=amp; aoTsLat[aoTsIdx]=lat; aoTsCpu[aoTsIdx]=cpu; aoTsDsp[aoTsIdx]=dsp
  aoTsIdx = (aoTsIdx + 1) % AO_TS_LEN
  if (aoTsCount < AO_TS_LEN) aoTsCount++
}

function _fft(re, im) {
  const N = re.length
  for (let i=1,j=0;i<N;i++){let b=N>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
  for (let len=2;len<=N;len<<=1){const ang=-2*Math.PI/len,wRe=Math.cos(ang),wIm=Math.sin(ang);for(let i=0;i<N;i+=len){let cRe=1,cIm=0;const h=len>>1;for(let j=0;j<h;j++){const uR=re[i+j],uI=im[i+j],tR=cRe*re[i+j+h]-cIm*im[i+j+h],tI=cRe*im[i+j+h]+cIm*re[i+j+h];re[i+j]=uR+tR;im[i+j]=uI+tI;re[i+j+h]=uR-tR;im[i+j+h]=uI-tI;const nr=cRe*wRe-cIm*wIm;cIm=cRe*wIm+cIm*wRe;cRe=nr;}}}
}

function drawAoSpectrum(which, b64pcm) {
  const now = performance.now()
  if (now - (aoSpecLastDraw[which] || 0) < 40) return
  aoSpecLastDraw[which] = now
  const canvas = which === 'in' ? specInCanvas.value : specOutCanvas.value
  if (!canvas) return
  const raw = atob(b64pcm), N = 512, n = Math.min(N, raw.length >> 1)
  for (let i=0;i<N;i++){if(i<n){const lo=raw.charCodeAt(i*2)&0xff,hi=raw.charCodeAt(i*2+1)&0xff;let s=(hi<<8)|lo;if(s>=32768)s-=65536;aoSpecFFTRe[i]=s/32768;}else aoSpecFFTRe[i]=0;aoSpecFFTIm[i]=0;}
  for (let i=0;i<N;i++){const w=0.42-0.5*Math.cos(2*Math.PI*i/(N-1))+0.08*Math.cos(4*Math.PI*i/(N-1));aoSpecFFTRe[i]*=w;}
  _fft(aoSpecFFTRe, aoSpecFFTIm)
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height
  const PL=44,PR=8,PT=12,PB=24,PW=W-PL-PR,PH=H-PT-PB
  const DB_MIN=-100,DB_MAX=0,SR=48000,MAX_HZ=16000,MAX_BIN=Math.round(MAX_HZ/(SR/N))
  ctx.fillStyle='#05080f';ctx.fillRect(0,0,W,H)
  ctx.font='10px monospace';ctx.textAlign='right'
  ;[-100,-75,-50,-25,0].forEach(db=>{const y=PT+(db-DB_MAX)/(DB_MIN-DB_MAX)*PH;ctx.strokeStyle='#1a2f4a';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(PL,y);ctx.lineTo(W-PR,y);ctx.stroke();ctx.fillStyle='#3d5068';ctx.fillText(db,PL-3,y+3);})
  ctx.textAlign='center'
  ;[0,1000,2000,4000,8000,12000,16000].forEach(hz=>{const x=PL+(Math.round(hz/(SR/N))/MAX_BIN)*PW;if(x<PL||x>W-PR)return;ctx.strokeStyle='#1a2f4a';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(x,PT);ctx.lineTo(x,H-PB);ctx.stroke();ctx.fillStyle='#3d5068';ctx.fillText(hz===0?'0':(hz>=1000?(hz/1000)+'k':hz),x,H-7);})
  ctx.save();ctx.translate(11,PT+PH/2);ctx.rotate(-Math.PI/2);ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillStyle='#475569';ctx.fillText('Amplitude (dBFS)',0,0);ctx.restore()
  ctx.strokeStyle='#334155';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(PL,PT);ctx.lineTo(PL,H-PB);ctx.lineTo(W-PR,H-PB);ctx.stroke()
  ctx.strokeStyle=which==='in'?'#22c55e':'#3b82f6';ctx.lineWidth=1.5;ctx.beginPath()
  for(let b=1;b<=MAX_BIN;b++){const re=aoSpecFFTRe[b],im=aoSpecFFTIm[b],db=20*Math.log10(Math.sqrt(re*re+im*im)+1e-9),x=PL+(b/MAX_BIN)*PW,y=PT+(_clamp(db,DB_MIN,DB_MAX)-DB_MAX)/(DB_MIN-DB_MAX)*PH;if(b===1)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  ctx.stroke()
}

function drawTrendLine(canvas, buf, tsIdx, tsCount, TS_LEN, color, unit) {
  if (!canvas || tsCount < 2) return
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,PL=42,PR=6,PT=6,PB=14,PW=W-PL-PR,PH=H-PT-PB
  const n=Math.min(tsCount,TS_LEN),si=tsCount<TS_LEN?0:tsIdx
  let vMin=Infinity,vMax=-Infinity
  for(let i=0;i<n;i++){const v=buf[(si+i)%TS_LEN];if(v<vMin)vMin=v;if(v>vMax)vMax=v;}
  if(vMin===vMax){vMin-=1;vMax+=1;}
  const mg=(vMax-vMin)*0.15||0.5;vMin-=mg;vMax+=mg
  ctx.fillStyle='#05080f';ctx.fillRect(0,0,W,H)
  ctx.font='9px monospace';ctx.textAlign='right'
  ;[vMin,(vMin+vMax)/2,vMax].forEach(v=>{const y=PT+(1-(v-vMin)/(vMax-vMin))*PH;ctx.strokeStyle='#1a2f4a';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(PL,y);ctx.lineTo(W-PR,y);ctx.stroke();ctx.fillStyle='#3d5068';ctx.fillText(v.toFixed(v<10?2:0)+(unit||''),PL-3,y+3);})
  ctx.strokeStyle='#334155';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(PL,PT);ctx.lineTo(PL,H-PB);ctx.lineTo(W-PR,H-PB);ctx.stroke()
  ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath()
  for(let i=0;i<n;i++){const v=buf[(si+i)%TS_LEN],x=PL+(i/(n-1))*PW,y=PT+(1-_clamp((v-vMin)/(vMax-vMin),0,1))*PH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
  ctx.stroke()
}

function drawAoLoadChart() {
  const canvas=tsLoadCanvas.value; if(!canvas||aoTsCount<2)return
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,PL=42,PR=6,PT=6,PB=14,PW=W-PL-PR,PH=H-PT-PB
  const n=Math.min(aoTsCount,AO_TS_LEN),si=aoTsCount<AO_TS_LEN?0:aoTsIdx
  ctx.fillStyle='#05080f';ctx.fillRect(0,0,W,H)
  ctx.font='9px monospace';ctx.textAlign='right'
  ;[0,50,100].forEach(v=>{const y=PT+(1-v/100)*PH;ctx.strokeStyle='#1a2f4a';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(PL,y);ctx.lineTo(W-PR,y);ctx.stroke();ctx.fillStyle='#3d5068';ctx.fillText(v+'%',PL-3,y+3);})
  ctx.strokeStyle='#334155';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(PL,PT);ctx.lineTo(PL,H-PB);ctx.lineTo(W-PR,H-PB);ctx.stroke()
  ;[[aoTsCpu,'#3b82f6'],[aoTsDsp,'#f59e0b']].forEach(([buf,col])=>{ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.beginPath();for(let i=0;i<n;i++){const v=buf[(si+i)%AO_TS_LEN],x=PL+(i/(n-1))*PW,y=PT+(1-_clamp(v/100,0,1))*PH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();})
  ctx.textAlign='left';ctx.font='9px sans-serif'
  ctx.fillStyle='#3b82f6';ctx.fillRect(W-76,9,12,2);ctx.fillStyle='#94a3b8';ctx.fillText('CPU',W-61,13)
  ctx.fillStyle='#f59e0b';ctx.fillRect(W-36,9,12,2);ctx.fillStyle='#94a3b8';ctx.fillText('DSP',W-21,13)
}

function clearAoCanvases() {
  ;[specInCanvas,specOutCanvas,tsAmpCanvas,tsLatCanvas,tsLoadCanvas].forEach(r=>{if(!r.value)return;const c=r.value.getContext('2d');c.fillStyle='#05080f';c.fillRect(0,0,r.value.width,r.value.height);})
}

// ── 2D FFT ─────────────────────────────────────────────────────────────
function toggleFft2d() { if (fft2d.running) stopFft2d(); else startFft2d() }

function startFft2d() {
  if (conflictActive[1]) { checkConflictOverlay(1); return }
  fft2d.running = true
  fft2d.statusMsg = 'Starting rpmsg_2dfft_example…'; fft2d.statusColor = '#f59e0b'; fft2d.statusPulse = true
  fft2d.result='--'; fft2d.resultColor='#e2e8f0'; fft2d.elapsed='-- ms'
  fft2d.badge='Running…'; fft2d.badgeColor='#f59e0b'
  fft2d.load='--%'; fft2d.cycles='--'; fft2d.ddr='-- MB/s'
  if (fft2dLogEl.value) fft2dLogEl.value.innerHTML = ''
  fetch('/2dfft/run')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status) })
    .then(() => connectFft2dWs())
    .catch(err => { fft2d.statusMsg = 'Error: ' + err.message; fft2d.statusColor = '#ef4444'; fft2d.statusPulse = false; fft2d.running = false })
}

function stopFft2d() {
  fetch('/2dfft/stop').catch(() => {})
  fft2d.running = false
  if (fft2dWs) { try { fft2dWs.close() } catch (_) {} fft2dWs = null }
  fft2d.statusMsg = 'Stopped'; fft2d.statusColor = '#64748b'; fft2d.statusPulse = false
}

function connectFft2dWs() {
  if (fft2dWs && (fft2dWs.readyState === 0 || fft2dWs.readyState === 1)) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  fft2dWs = new WebSocket(`${proto}//${location.host}/2dfft`)
  fft2dWs.onmessage = e => {
    try {
      const d = JSON.parse(e.data)
      if (d.type === 'status') {
        const c = d.state==='running' ? '#f59e0b' : d.state==='stopped' ? '#22c55e' : '#64748b'
        fft2d.statusMsg = d.message; fft2d.statusColor = c; fft2d.statusPulse = d.state === 'running'
      } else if (d.type === 'log') {
        appendLog(fft2dLogEl.value, d.text, /error|fail/i.test(d.text) ? '#ef4444' : /passed/i.test(d.text) ? '#22c55e' : /^\*+$/.test(d.text.trim()) ? '#1e3a5a' : '#94a3b8')
        parseFft2dMetrics(d.text)
      } else if (d.type === 'result') {
        const pass = d.status === 'PASSED'
        fft2d.result = d.status; fft2d.resultColor = pass ? '#22c55e' : '#ef4444'
        fft2d.badge  = d.status; fft2d.badgeColor  = pass ? '#22c55e' : '#ef4444'
      } else if (d.type === 'done') {
        const pass = d.status === 'PASSED', ms = d.elapsed != null ? d.elapsed + ' ms' : '--'
        fft2d.elapsed = ms
        fft2d.statusMsg = pass ? 'Completed: PASSED' : 'Completed: FAILED'
        fft2d.statusColor = pass ? '#22c55e' : '#ef4444'; fft2d.statusPulse = false
        fft2d.running = false
      }
    } catch (err) { console.warn('[fft2d-ws]', err) }
  }
  fft2dWs.onclose = () => { if (fft2d.running) { fft2d.statusMsg = 'Connection lost'; fft2d.statusColor = '#ef4444' } }
  fft2dWs.onerror = () => {}
}

function parseFft2dMetrics(text) {
  let m
  if ((m = text.match(/C7x Load:\s*(\d+)%/i))) {
    const v = parseInt(m[1]); fft2d.load = v + '%'
    fft2dStats.load = _accum(fft2dStats.load, v)
    const s = fft2dStats.load
    if (s) { fft2d.loadMin = s.min.toFixed(0)+'%'; fft2d.loadAvg = (s.sum/s.n).toFixed(0)+'%'; fft2d.loadMax = s.max.toFixed(0)+'%' }
  }
  if ((m = text.match(/C7x Cycle Count:\s*([\d,]+)/i)))
    fft2d.cycles = parseInt(m[1].replace(/,/g,'')).toLocaleString()
  if ((m = text.match(/C7x DDR Throughput:\s*([\d.]+)\s*MB\/s/i))) {
    const v = parseFloat(m[1]); fft2d.ddr = v.toFixed(6) + ' MB/s'
    fft2dStats.ddr = _accum(fft2dStats.ddr, v)
    const s = fft2dStats.ddr
    if (s) { fft2d.ddrMin = s.min.toFixed(3)+' MB/s'; fft2d.ddrAvg = (s.sum/s.n).toFixed(3)+' MB/s'; fft2d.ddrMax = s.max.toFixed(3)+' MB/s' }
  }
}

// ── Sigchain Biquad ────────────────────────────────────────────────────
const BIQUAD_TS_LEN  = 600
const biquadTsLoad   = new Float32Array(BIQUAD_TS_LEN)
const biquadTsCycles = new Float32Array(BIQUAD_TS_LEN)
const biquadTsTput   = new Float32Array(BIQUAD_TS_LEN)
let biquadTsIdx = 0, biquadTsCount = 0

function toggleBiquad() { if (biquad.running) stopBiquad(); else startBiquad() }

function startBiquad() {
  if (!biquad.overlayActive) { checkBiquadOverlay(); return }
  biquad.running = true
  biquadStats = { load: null }
  biquad.loadMin=biquad.loadAvg=biquad.loadMax='--'
  biquad.statusMsg = 'Starting rpmsg_sigchain_biquad_example…'; biquad.statusColor = '#f59e0b'; biquad.statusPulse = true
  biquadTsLoad.fill(0); biquadTsCycles.fill(0); biquadTsTput.fill(0)
  biquadTsIdx = 0; biquadTsCount = 0
  biquad.cycles = '--'; biquad.tput = '-- MB/s'
  if (biquadLogEl.value) biquadLogEl.value.innerHTML = ''
  fetch('/sigchain-biquad/run')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status) })
    .then(() => connectBiquadWs())
    .catch(err => { biquad.statusMsg = 'Error: ' + err.message; biquad.statusColor = '#ef4444'; biquad.statusPulse = false; biquad.running = false })
}

function stopBiquad() {
  fetch('/sigchain-biquad/stop').catch(() => {})
  biquad.running = false
  if (biquadWs) { try { biquadWs.close() } catch (_) {} biquadWs = null }
  biquad.statusMsg = 'Stopped'; biquad.statusColor = '#64748b'; biquad.statusPulse = false
}

function connectBiquadWs() {
  if (biquadWs && (biquadWs.readyState === 0 || biquadWs.readyState === 1)) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  biquadWs = new WebSocket(`${proto}//${location.host}/sigchain-biquad`)
  biquadWs.onmessage = e => {
    try {
      const d = JSON.parse(e.data)
      if (d.type === 'status') {
        const c = d.state==='connected' ? '#22c55e' : d.state==='connecting' ? '#f59e0b' : d.state==='stopped' ? '#64748b' : '#ef4444'
        biquad.statusMsg = d.message; biquad.statusColor = c; biquad.statusPulse = d.state === 'connecting'
        if (d.state === 'stopped') { biquad.running = false }
      } else if (d.type === 'log') {
        appendLog(biquadLogEl.value, d.text, /error/i.test(d.text) ? '#ef4444' : /loaded|success|running/i.test(d.text) ? '#22c55e' : /warn/i.test(d.text) ? '#f59e0b' : '#94a3b8')
      } else if (d.type === 'stats') {
        if (d.c7xLoad != null) {
          biquad.load = d.c7xLoad.toFixed(1) + '%'
          if (biquadStats) { biquadStats.load = _accum(biquadStats.load, d.c7xLoad); const s=biquadStats.load; if(s){biquad.loadMin=s.min.toFixed(1)+'%';biquad.loadAvg=(s.sum/s.n).toFixed(1)+'%';biquad.loadMax=s.max.toFixed(1)+'%';} }
        }
        if (d.cycles    != null) biquad.cycles = d.cycles.toLocaleString()
        if (d.throughput != null) biquad.tput = d.throughput.toFixed(2) + ' MB/s'
        biquadTsLoad[biquadTsIdx]   = d.c7xLoad    ?? 0
        biquadTsCycles[biquadTsIdx] = d.cycles     ?? 0
        biquadTsTput[biquadTsIdx]   = d.throughput ?? 0
        biquadTsIdx = (biquadTsIdx + 1) % BIQUAD_TS_LEN
        if (biquadTsCount < BIQUAD_TS_LEN) biquadTsCount++
        biquad.loadLbl = `C7x DSP Load (${biquadTsCount} samples)`
        if (d.cycles    != null) biquad.cyclesLbl = `DSP Processing Cycles (Latest: ${d.cycles.toLocaleString()})`
        if (d.throughput != null) { const avg = biquadTsTput.slice(0,biquadTsCount).reduce((a,b)=>a+b,0)/biquadTsCount; biquad.tputLbl = `Demo Throughput (Avg: ${avg.toFixed(2)} MB/s)` }
        drawTrendLine(bqLoadCanvas.value,   biquadTsLoad,   biquadTsIdx, biquadTsCount, BIQUAD_TS_LEN, '#3b82f6', '%')
        drawTrendLine(bqCyclesCanvas.value, biquadTsCycles, biquadTsIdx, biquadTsCount, BIQUAD_TS_LEN, '#ef4444', '')
        drawTrendLine(bqTputCanvas.value,   biquadTsTput,   biquadTsIdx, biquadTsCount, BIQUAD_TS_LEN, '#22c55e', ' MB/s')
      }
    } catch (err) { console.warn('[biquad-ws]', err) }
  }
  biquadWs.onclose = () => { if (biquad.running) { biquad.statusMsg = 'Connection lost'; biquad.statusColor = '#ef4444' } }
  biquadWs.onerror = () => {}
}

// ── Shared log helper ──────────────────────────────────────────────────
function appendLog(box, text, color) {
  if (!box) return
  const div = document.createElement('div')
  div.style.cssText = 'padding:1px 0;word-break:break-all;'
  div.style.color = color
  div.textContent = text.replace(/\n$/, '')
  box.appendChild(div)
  box.scrollTop = box.scrollHeight
}

// ── Lifecycle ──────────────────────────────────────────────────────────
onMounted(() => {
  checkConflictOverlay(0)
  nextTick(clearAoCanvases)
})

onUnmounted(() => {
  // Stop any running demo so the binary gets SIGINT on the EVM
  if (ao.running)     fetch('/audio-offload/stop').catch(() => {})
  if (fft2d.running)  fetch('/2dfft/stop').catch(() => {})
  if (biquad.running) fetch('/sigchain-biquad/stop').catch(() => {})

  if (aoWs)     { try { aoWs.close()     } catch (_) {} }
  if (fft2dWs)  { try { fft2dWs.close()  } catch (_) {} }
  if (biquadWs) { try { biquadWs.close() } catch (_) {} }
  if (_rebootWs){ try { _rebootWs.close()} catch (_) {} }
})
</script>

<style scoped>
.dsp-page {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
  padding: 14px 16px 0; gap: 12px;
}

/* Header */
.page-hdr { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 16px; }
.ph-left  { display: flex; align-items: center; gap: 14px; }
.ph-icon  { width:50px;height:50px;border-radius:50%;flex-shrink:0;background:radial-gradient(circle at 40% 40%,#3a1a00,#1f0d00);border:2px solid #d97706;color:#fbbf24;display:flex;align-items:center;justify-content:center; }
.ph-title { font-size:21px;font-weight:800;color:rgb(var(--v-theme-on-surface));margin-bottom:3px; }
.ph-sub   { font-size:13px;color:#64748b; }

/* Grid */
.content-grid { display:grid;grid-template-columns:280px 1fr;gap:14px;flex:1;min-height:0;padding-bottom:14px; }
.demo-panel   { display:flex;flex-direction:column;gap:14px;min-height:0;overflow-y:auto; }
.viz-card     { flex-shrink:0; }
.ctrl-card    { overflow-y:visible !important; flex-shrink:0; }

/* Card */
.card { background:rgb(var(--v-theme-surface));border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;overflow-y:auto; }
.ctrl-card { overflow-y:auto; }
.card-ttl { font-size:13px;font-weight:700;color:rgb(var(--v-theme-on-surface));flex-shrink:0; }
.card-div { border:none;border-top:1px solid rgba(var(--v-border-color),var(--v-border-opacity));margin:2px 0;flex-shrink:0; }

/* Demo selector */
.dsi { display:flex;align-items:center;gap:11px;padding:11px 12px;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:9px;cursor:pointer;transition:all 0.15s;flex-shrink:0; }
.dsi:hover { border-color:#d97706;background:rgba(217,119,6,0.05); }
.dsi.active { border-color:#d97706;background:rgba(217,119,6,0.09); }
.dsi-ic { width:36px;height:36px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center; }
.dsi-txt { flex:1;min-width:0; }
.dsi-name { font-size:13px;font-weight:600;color:rgb(var(--v-theme-on-surface)); }
.dsi-sub  { font-size:11px;color:#64748b;margin-top:2px; }
.dsi-arr  { color:#d97706;font-size:16px;flex-shrink:0; }

/* Controls */
.desc-text { font-size:13px;color:#94a3b8;line-height:1.65;flex-shrink:0; }
.sub-ttl   { font-size:12.5px;font-weight:700;color:rgb(var(--v-theme-on-surface));flex-shrink:0; }
.status-row{ display:flex;align-items:center;gap:7px;flex-shrink:0; }
.status-dot{ width:8px;height:8px;border-radius:50%;flex-shrink:0; }
.filter-row{ display:flex;gap:6px;align-items:center;flex-shrink:0; }
.filter-lbl{ font-size:11px;color:#94a3b8;flex-shrink:0; }
.filt-btn  { flex:1;padding:5px 8px;background:rgb(var(--v-theme-surface-variant));border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));color:#64748b;font-size:11px;font-weight:600;border-radius:5px;cursor:pointer; }
.filt-btn.active { background:#d97706;border-color:#b45309;color:#fff; }

/* Metrics */
.metrics-grid { display:grid;grid-template-columns:1fr 1fr;gap:6px;flex-shrink:0; }
.metric-tile  { background:rgb(var(--v-theme-surface-variant));border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:6px;padding:8px 10px; }
.mt-lbl  { font-size:10px;color:#64748b;margin-bottom:3px; }
.mt-val  { font-size:16px;font-weight:700;color:rgb(var(--v-theme-on-surface)); }
.mt-stats{ display:flex;gap:4px;margin-top:4px;font-size:9px;color:#475569;flex-wrap:wrap; }
.sep { color:rgba(var(--v-border-color),var(--v-border-opacity)); }
.sv  { color:#94a3b8; }

/* Feature list */
.feat-list { list-style:none;display:flex;flex-direction:column;gap:5px;flex-shrink:0; }
.feat-list li { display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#94a3b8; }

/* Banners */
.conflict-banner { display:flex;flex-direction:column;gap:8px;padding:12px;background:#120800;border:1px solid #ef4444;border-radius:8px;flex-shrink:0; }
.warn-banner     { display:flex;flex-direction:column;gap:8px;padding:12px;background:#120800;border:1px solid #d97706;border-radius:8px;flex-shrink:0; }
.banner-hdr  { display:flex;align-items:center;gap:8px; }
.banner-body { font-size:11px;color:#94a3b8;line-height:1.6; }
.overlay-code{ font-family:monospace;font-size:10.5px;background:rgb(var(--v-theme-surface-variant));border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:5px;padding:8px 10px;color:#22d3ee;word-break:break-all;line-height:1.5;display:block; }
.overlay-ok  { display:flex;align-items:center;gap:8px;padding:8px 10px;background:#031a0e;border:1px solid #166534;border-radius:6px;flex-shrink:0; }
.rem-btn     { padding:8px 12px;background:#dc2626;border:none;color:#fff;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;justify-content:center; }
.rem-btn:hover { background:#b91c1c; }
.apply-btn   { padding:8px 12px;background:#d97706;border:none;color:#fff;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:6px;justify-content:center; }
.apply-btn:hover { background:#b45309; }

/* Run button */
.btn-run-this { background:#d97706;border:none;color:#fff;padding:11px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:background 0.2s;flex-shrink:0;width:100%; }
.btn-run-this:hover    { background:#b45309; }
.btn-run-this.running  { background:#dc2626; }
.btn-run-this.running:hover { background:#b91c1c; }
.btn-run-this:disabled { opacity:0.38;cursor:not-allowed;pointer-events:none; }
.btn-run-this.fft-btn  { background:#0891b2; }
.btn-run-this.fft-btn:hover { background:#0e7490; }
.btn-run-this.fft-btn.running { background:#dc2626; }
.btn-run-this.biquad-btn { background:#7c3aed; }
.btn-run-this.biquad-btn:hover { background:#6d28d9; }
.btn-run-this.biquad-btn.running { background:#dc2626; }

/* Visualization */
.canvas-wrap { display:flex;flex-direction:column;gap:3px;flex-shrink:0; }
.canvas-lbl  { font-size:11px;color:#64748b; }
.viz-canvas  { border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));width:100%;border-radius:4px;display:block; }
.fft-header  { padding:10px 14px;background:rgb(var(--v-theme-surface-variant));border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:8px;flex-shrink:0; }
.fft-metrics { display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;flex-shrink:0; }
.log-box     { font-family:monospace;font-size:11px;background:rgb(var(--v-theme-surface-variant));border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:6px;padding:10px;overflow-y:auto;color:#94a3b8;word-break:break-all;line-height:1.5;flex-shrink:0; }

/* Reboot overlay */
.reboot-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;display:flex;align-items:center;justify-content:center; }
.reboot-box { background:rgb(var(--v-theme-surface));border:1px solid #d97706;border-radius:12px;padding:32px 40px;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:400px;text-align:center; }
.reboot-title { font-size:18px;font-weight:700;color:rgb(var(--v-theme-on-surface)); }
.reboot-msg   { font-size:13px;color:#94a3b8;line-height:1.6; }

@keyframes pulse { 0%,100%{opacity:0.6}50%{opacity:1} }
</style>
