<template>
  <div class="audio-dsp-view">

    <!-- Page header -->
    <div class="page-hdr">
      <div class="ph-left">
        <div class="ph-icon">
          <v-icon size="22" color="blue-lighten-2">mdi-waveform</v-icon>
        </div>
        <div>
          <div class="ph-title">DSP with Audio Analytics</div>
          <div class="ph-sub">Real-time audio analytics powered by the C7x DSP — AI-enabled noise reduction, speech enhancement, and acoustic event detection on AM62D.</div>
        </div>
      </div>
      <v-btn
        :color="demoRunning ? 'error' : 'primary'"
        variant="flat"
        size="small"
        :disabled="!canRun && !demoRunning"
        :prepend-icon="demoRunning ? 'mdi-stop' : 'mdi-play'"
        class="run-btn"
        @click="triggerRun"
      >{{ demoRunning ? 'Stop Demo' : 'Run Demo' }}</v-btn>
    </div>

    <!-- Two-column content grid -->
    <div class="content-grid">

      <!-- Demo selector -->
      <v-card class="ti-card demo-selector" flat>
        <div class="card-ttl" style="display:flex;align-items:center;justify-content:space-between">
          Demo Selection
        </div>

        <div
          v-for="(d, i) in demos"
          :key="i"
          class="dsi"
          :class="{ active: activeIdx === i }"
          @click="selectDemo(i)"
        >
          <div class="dsi-ic" :style="d.iconStyle">
            <v-icon size="16">{{ d.icon }}</v-icon>
          </div>
          <div class="dsi-txt">
            <div class="dsi-name">{{ d.name }}</div>
            <div class="dsi-sub">{{ d.sub }}</div>
          </div>
          <span class="dsi-arr">›</span>
        </div>
      </v-card>

      <!-- Active demo panel -->
      <div class="demo-panel">
        <component :is="currentComponent" ref="activeDemo" @running-change="onRunningChange" />
      </div>

    </div>

  </div>
</template>

<script setup>
import { ref, computed, shallowRef, onUnmounted } from 'vue'
import SpeechEnhancement  from '../demos/SpeechEnhancement.vue'
import TvmInference        from '../demos/TvmInference.vue'
import AudioClassification from '@/demos/AudioClassification.vue'

const demos = [
  {
    name: 'Speech Enhancement',
    sub:  'C7x DSP noise reduction + TIDL',
    icon: 'mdi-microphone-outline',
    iconStyle: 'background:radial-gradient(circle at 40% 40%,#0d3a2e,#062018);border:2px solid #059669;color:#34d399',
    component: SpeechEnhancement,
    canRun: true,
  },
  {
    name: 'Audio Classification',
    sub:  'AI based audio event classification',
    icon: 'mdi-chart-bar',
    iconStyle: 'background:radial-gradient(circle at 40% 40%,#3b1c68,#1e0d40);border:2px solid #7c3aed;color:#c084fc',
    component: AudioClassification,
    canRun: true,
  },
  {
    name: 'TVM Inference',
    sub:  'GCRN on C7x DSP via TVM+TIDL',
    icon: 'mdi-flash',
    iconStyle: 'background:radial-gradient(circle at 40% 40%,#1a3a7a,#0a1540);border:2px solid #1d4ed8;color:#60a5fa',
    component: TvmInference,
    canRun: true,
  },
]

const activeIdx        = ref(0)
const activeDemo       = ref(null)
const currentComponent = shallowRef(demos[0].component)
const demoRunning      = ref(false)
const canRun = computed(() => demos[activeIdx.value].canRun)

function selectDemo(i) {
  if (demoRunning.value) return
  activeIdx.value        = i
  currentComponent.value = demos[i].component
  demoRunning.value      = false
}

function onRunningChange(v) { demoRunning.value = v }

function triggerRun() {
  if (demoRunning.value) activeDemo.value?.stop()
  else activeDemo.value?.run()
}

onUnmounted(() => {
  if (demoRunning.value) activeDemo.value?.stop()
})
</script>

<style scoped>
.audio-dsp-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  padding: 18px;
  overflow: hidden;
}
/* Page header */
.page-hdr { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-shrink:0; }
.ph-left  { display:flex; align-items:center; gap:14px; }
.ph-icon  { width:50px; height:50px; border-radius:50%; flex-shrink:0; background:radial-gradient(circle at 40% 40%,#1a3a7a,#0a1540); border:2px solid #1d4ed8; display:flex; align-items:center; justify-content:center; }
.ph-title { font-size:21px; font-weight:800; color:rgb(var(--v-theme-on-background)); margin-bottom:3px; }
.ph-sub   { font-size:13px; color:#64748b; }
.run-btn  { font-weight:600; letter-spacing:0; text-transform:none; }

/* Content grid */
.content-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 14px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Cards */
.ti-card {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
  border-radius: 12px !important;
  padding: 16px !important;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.card-ttl { font-size:12.5px; font-weight:700; color:rgb(var(--v-theme-on-surface)); }

/* Demo selector items */
.dsi { display:flex; align-items:center; gap:11px; padding:11px 12px; border:1px solid rgba(var(--v-border-color),var(--v-border-opacity)); border-radius:9px; cursor:pointer; transition:all .15s; flex-shrink:0; }
.dsi:hover  { border-color:#4da6ff; background:rgba(77,166,255,0.05); }
.dsi.active { border-color:#4da6ff; background:rgba(77,166,255,0.09); }
.dsi-ic { width:36px; height:36px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
.dsi-txt { flex:1; min-width:0; }
.dsi-name { font-size:13px; font-weight:600; color:rgb(var(--v-theme-on-surface)); }
.dsi-sub  { font-size:11px; color:#64748b; margin-top:2px; }
.dsi-arr  { color:#4da6ff; font-size:16px; flex-shrink:0; }

/* Demo panel */
.demo-panel { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.demo-panel > * { flex: 1; min-height: 0; }
</style>
