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
        :prepend-icon="topRunning ? 'mdi-stop' : 'mdi-play'"
        @click="triggerRun"
      >{{ topRunning ? 'Stop Demo' : 'Run Demo' }}</v-btn>
    </div>

    <!-- 2-column grid -->
    <div class="content-grid">

      <!-- Demo Selector -->
      <div class="card">
        <div class="card-ttl">Demo Selection</div>
        <div
          v-for="(demo, i) in demoList" :key="i"
          class="dsi" :class="{ active: activeIdx === i }"
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

      <!-- Active demo -->
      <div class="demo-panel">
        <component :is="currentComponent" ref="activeDemoRef" @running-change="onRunningChange" />
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, onUnmounted } from 'vue'
import AudioOffload   from '../demos/AudioOffload.vue'
import TwoDeeFft      from '../demos/2DFft.vue'
import SigchainBiquad from '../demos/SigchainBiquad.vue'

const demoList = [
  { name: 'Audio DSP Offload',  sub: '8-ch RPMsg-DMA on C7x DSP',       icon: 'mdi-chart-bar', icBg: 'radial-gradient(circle at 40% 40%,#3a1a00,#1f0d00)', icBd: '#d97706', icColor: '#fbbf24', component: AudioOffload   },
  { name: '2D FFT Offload',     sub: '128×128 on C7x via RPMsg-DMA',     icon: 'mdi-grid',      icBg: 'radial-gradient(circle at 40% 40%,#04201e,#021210)', icBd: '#0891b2', icColor: '#22d3ee', component: TwoDeeFft      },
  { name: 'Sigchain Biquad EQ', sub: '3-stage parametric EQ on C7x DSP', icon: 'mdi-pulse',     icBg: 'radial-gradient(circle at 40% 40%,#1e0d40,#0d0620)', icBd: '#7c3aed', icColor: '#c084fc', component: SigchainBiquad },
]

const activeIdx        = ref(0)
const currentComponent = shallowRef(demoList[0].component)
const activeDemoRef    = ref(null)
const topRunning       = ref(false)

function selectDemo(i) {
  if (i === activeIdx.value) return
  if (topRunning.value) activeDemoRef.value?.stop()
  activeIdx.value        = i
  currentComponent.value = demoList[i].component
  topRunning.value       = false
}

function onRunningChange(v) { topRunning.value = v }

function triggerRun() {
  if (topRunning.value) activeDemoRef.value?.stop()
  else activeDemoRef.value?.run()
}

onUnmounted(() => {
  if (topRunning.value) activeDemoRef.value?.stop()
})
</script>

<style scoped>
.dsp-page {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
  padding: 14px 16px 0; gap: 12px;
}
.page-hdr { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 16px; }
.ph-left  { display: flex; align-items: center; gap: 14px; }
.ph-icon  { width:50px;height:50px;border-radius:50%;flex-shrink:0;background:radial-gradient(circle at 40% 40%,#3a1a00,#1f0d00);border:2px solid #d97706;color:#fbbf24;display:flex;align-items:center;justify-content:center; }
.ph-title { font-size:21px;font-weight:800;color:rgb(var(--v-theme-on-surface));margin-bottom:3px; }
.ph-sub   { font-size:13px;color:#64748b; }
.content-grid { display:grid;grid-template-columns:280px 1fr;gap:14px;flex:1;min-height:0;padding-bottom:14px; }
.demo-panel   { display:flex;flex-direction:column;gap:14px;min-height:0;overflow-y:auto; }
.card { background:rgb(var(--v-theme-surface));border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;overflow-y:auto; }
.card-ttl { font-size:13px;font-weight:700;color:rgb(var(--v-theme-on-surface));flex-shrink:0; }
.dsi { display:flex;align-items:center;gap:11px;padding:11px 12px;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:9px;cursor:pointer;transition:all 0.15s;flex-shrink:0; }
.dsi:hover { border-color:#d97706;background:rgba(217,119,6,0.05); }
.dsi.active { border-color:#d97706;background:rgba(217,119,6,0.09); }
.dsi-ic { width:36px;height:36px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center; }
.dsi-txt { flex:1;min-width:0; }
.dsi-name { font-size:13px;font-weight:600;color:rgb(var(--v-theme-on-surface)); }
.dsi-sub  { font-size:11px;color:#64748b;margin-top:2px; }
.dsi-arr  { color:#d97706;font-size:16px;flex-shrink:0; }
</style>
