<template>
  <canvas ref="canvasEl" :height="height" style="width:100%;border-radius:6px;display:block;" />
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'

const props = defineProps({
  pcmFrame: { type: Object, default: null },
  colorMap: { type: String, default: 'blue' },  // 'blue' | 'green'
  bgColor:  { type: String, default: '#05080f' },
  height:   { type: Number, default: 100 },
  runKey:   { type: Number, default: 0 },
  maxCols:  { type: Number, default: 200 },      // time-axis window (zoom)
})

const canvasEl = ref(null)
const history  = []      // Float32Array[] — one entry per received frame
const NUM_BINS = 96      // more frequency bins → finer resolution

watch(() => props.runKey, () => { history.length = 0; drawEmpty() })

watch(() => props.pcmFrame, (frame) => {
  if (!frame?.pcm) return
  history.push(computeMagnitudes(frame.pcm, NUM_BINS))
  if (history.length > props.maxCols) history.shift()
  render()
})

watch(() => props.maxCols, (newCols) => {
  while (history.length > newCols) history.shift()
  history.length === 0 ? drawEmpty() : render()
})

watch(() => [props.bgColor, props.colorMap], () => {
  history.length === 0 ? drawEmpty() : render()
})

onMounted(() => drawEmpty())

defineExpose({ getCanvas: () => canvasEl.value })

/* ── render ────────────────────────────────────────────────────────────── */
function render() {
  const canvas = canvasEl.value
  if (!canvas) return
  const w = canvas.offsetWidth || canvas.width
  if (canvas.width !== w) canvas.width = w
  const h   = props.height
  const ctx = canvas.getContext('2d')

  const [br, bg, bb] = hexToRgb(props.bgColor)
  const img = ctx.createImageData(w, h)
  const px  = img.data

  // fill background
  for (let i = 0; i < px.length; i += 4) {
    px[i] = br; px[i + 1] = bg; px[i + 2] = bb; px[i + 3] = 255
  }

  if (history.length === 0) { ctx.putImageData(img, 0, 0); return }

  // use 95th-percentile as ceiling so bright bins always show full color
  const all = []
  for (const col of history) for (const v of col) all.push(v)
  all.sort((a, b) => a - b)
  const gMax = all[Math.floor(all.length * 0.95)] || 0.001

  for (let t = 0; t < history.length; t++) {
    const mags = history[t]
    const x0 = Math.floor((t + props.maxCols - history.length) * w / props.maxCols)
    const x1 = Math.min(w, Math.floor((t + props.maxCols - history.length + 1) * w / props.maxCols))
    if (x0 >= x1) continue

    for (let i = 0; i < NUM_BINS; i++) {
      // log scaling → pulls up quiet details; gamma → saturates bright areas faster
      const raw  = Math.min(mags[i] / gMax, 1)
      const norm = Math.pow(Math.log1p(raw * 9) / Math.log1p(9), 0.7)
      if (norm < 0.04) continue
      const [r, g, b] = colorRgb(norm)
      // low freq at bottom → invert y
      const y0 = Math.floor((NUM_BINS - 1 - i) * h / NUM_BINS)
      const y1 = Math.min(h, Math.ceil((NUM_BINS - i) * h / NUM_BINS))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * w + x) * 4
          px[idx] = r; px[idx + 1] = g; px[idx + 2] = b; px[idx + 3] = 255
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

function drawEmpty() {
  const canvas = canvasEl.value
  if (!canvas) return
  const w = canvas.offsetWidth || canvas.width
  if (canvas.width !== w) canvas.width = w
  const ctx = canvas.getContext('2d')
  const [r, g, b] = hexToRgb(props.bgColor)
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, w, props.height)
}

/* ── color maps ────────────────────────────────────────────────────────── */
function colorRgb(n) {
  // Blue map: black → deep blue → cyan → white-hot
  if (props.colorMap === 'blue') {
    if (n < 0.2)  { const t = n / 0.2;         return [0,                    0,                    Math.round(t * 220)]         }
    if (n < 0.45) { const t = (n-0.2)/0.25;    return [0,                    Math.round(t*180),    Math.round(220+t*35)]        }
    if (n < 0.7)  { const t = (n-0.45)/0.25;   return [Math.round(t*100),   Math.round(180+t*75), 255]                         }
    {              const t = (n-0.7)/0.3;       return [Math.round(100+t*155), 255,                 255]                         }
  } else {
    // Green map: black → dark green → bright green → yellow → white-hot
    if (n < 0.2)  { const t = n / 0.2;         return [0,                    Math.round(t*130),    0]                           }
    if (n < 0.45) { const t = (n-0.2)/0.25;    return [0,                    Math.round(130+t*125), 0]                          }
    if (n < 0.7)  { const t = (n-0.45)/0.25;   return [Math.round(t*255),   255,                   0]                          }
    {              const t = (n-0.7)/0.3;       return [255,                  255,                   Math.round(t*255)]           }
  }
}

/* ── FFT ───────────────────────────────────────────────────────────────── */
function computeMagnitudes(int16, numBins) {
  const N = 1024
  const re = new Float32Array(N)
  const im = new Float32Array(N)
  const len = Math.min(N, int16.length)
  for (let i = 0; i < len; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (len - 1)))
    re[i] = (int16[i] / 32768) * w
  }
  let j = 0
  for (let i = 1; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t }
  }
  for (let half = 1; half < N; half <<= 1) {
    const ang = -Math.PI / half
    const wc = Math.cos(ang), ws = Math.sin(ang)
    for (let k = 0; k < N; k += half << 1) {
      let cr = 1, ci = 0
      for (let n = 0; n < half; n++) {
        const ur = re[k+n], ui = im[k+n]
        const vr = re[k+n+half]*cr - im[k+n+half]*ci
        const vi = re[k+n+half]*ci + im[k+n+half]*cr
        re[k+n] = ur+vr; im[k+n] = ui+vi
        re[k+n+half] = ur-vr; im[k+n+half] = ui-vi
        const tmp = cr*wc - ci*ws; ci = cr*ws + ci*wc; cr = tmp
      }
    }
  }
  const half = N >> 1
  const step = Math.floor(half / numBins)
  const mags = new Float32Array(numBins)
  for (let b = 0; b < numBins; b++) {
    let sum = 0
    const start = b * step
    let end = start + step
    if (end > half) end = half
    for (let k = start; k < end; k++) {
      sum += re[k]*re[k] + im[k]*im[k]
    }
    mags[b] = Math.sqrt(sum / (end - start))
  }
  return mags
}

function hexToRgb(hex) {
  hex = hex.replace('#', '')
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('')
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)]
}
</script>
