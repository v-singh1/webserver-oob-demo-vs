<template>
  <canvas ref="canvasEl" :height="height" style="width:100%;border-radius:6px;display:block;" />
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  pcmFrame: { type: Object, default: null },  // { pcm: Int16Array, sampleRate }
  color:    { type: String, default: '#4da6ff' },
  height:   { type: Number, default: 80 },
})

const canvasEl  = ref(null)
const smoothed  = ref(null)   // Float32Array of smoothed magnitudes
const NUM_BINS  = 64
const DECAY     = 0.75        // per-frame smoothing

watch(() => props.pcmFrame, (frame) => {
  if (!frame) return
  const mags = computeMagnitudes(frame.pcm, NUM_BINS)
  if (!smoothed.value) smoothed.value = new Float32Array(NUM_BINS)
  for (let i = 0; i < NUM_BINS; i++) {
    smoothed.value[i] = Math.max(mags[i], smoothed.value[i] * DECAY)
  }
  draw()
})

function draw() {
  const canvas = canvasEl.value
  if (!canvas || !smoothed.value) return
  const ctx  = canvas.getContext('2d')
  const w    = canvas.offsetWidth || canvas.width
  const h    = props.height
  canvas.width = w
  ctx.clearRect(0, 0, w, h)

  const max  = Math.max(...smoothed.value, 0.001)
  const bw   = w / NUM_BINS
  const gap  = Math.max(1, bw * 0.15)

  for (let i = 0; i < NUM_BINS; i++) {
    const norm  = smoothed.value[i] / max
    const bh    = Math.max(2, norm * (h - 4))
    const x     = i * bw + gap / 2
    const alpha = 0.4 + 0.6 * norm
    ctx.fillStyle = hexToRgba(props.color, alpha)
    ctx.fillRect(x, h - bh, bw - gap, bh)
  }
}

onMounted(() => { drawEmpty() })

function drawEmpty() {
  const canvas = canvasEl.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  canvas.width = canvas.offsetWidth || canvas.width
  ctx.clearRect(0, 0, canvas.width, props.height)
  const bw = canvas.width / NUM_BINS
  const gap = Math.max(1, bw * 0.15)
  for (let i = 0; i < NUM_BINS; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(i * bw + gap / 2, props.height - 3, bw - gap, 3)
  }
}

// Iterative Cooley-Tukey FFT → magnitude bins
function computeMagnitudes(int16, numBins) {
  const N    = 1024
  const re   = new Float32Array(N)
  const im   = new Float32Array(N)
  const len  = Math.min(N, int16.length)

  for (let i = 0; i < len; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (len - 1)))  // Hann
    re[i] = (int16[i] / 32768) * w
  }

  // Bit-reversal permutation
  let j = 0
  for (let i = 1; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t }
  }

  // Butterfly passes
  for (let half = 1; half < N; half <<= 1) {
    const ang  = -Math.PI / half
    const wCos = Math.cos(ang)
    const wSin = Math.sin(ang)
    for (let k = 0; k < N; k += half << 1) {
      let cr = 1, ci = 0
      for (let n = 0; n < half; n++) {
        const ur = re[k+n],        ui = im[k+n]
        const vr = re[k+n+half]*cr - im[k+n+half]*ci
        const vi = re[k+n+half]*ci + im[k+n+half]*cr
        re[k+n]       = ur + vr;  im[k+n]       = ui + vi
        re[k+n+half]  = ur - vr;  im[k+n+half]  = ui - vi
        const tmp = cr * wCos - ci * wSin
        ci = cr * wSin + ci * wCos
        cr = tmp
      }
    }
  }

  // Collapse N/2 bins into numBins
  const half  = N / 2
  const step  = Math.floor(half / numBins)
  const mags  = new Float32Array(numBins)
  for (let b = 0; b < numBins; b++) {
    let sum = 0
    for (let k = 0; k < step; k++) {
      const idx = b * step + k
      sum += Math.sqrt(re[idx] * re[idx] + im[idx] * im[idx])
    }
    mags[b] = sum / step
  }
  return mags
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${alpha})`
}
</script>
