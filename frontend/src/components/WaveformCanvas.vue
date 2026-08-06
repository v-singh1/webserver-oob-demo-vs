<template>
  <canvas ref="canvasEl" :height="height" style="width:100%;border-radius:6px;display:block;" />
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'

const props = defineProps({
  pcmFrame: { type: Object, default: null },
  color:    { type: String, default: '#4da6ff' },
  bgColor:  { type: String, default: '#05080f' },
  height:   { type: Number, default: 64 },
  runKey:   { type: Number, default: 0 },
  yZoom:    { type: Number, default: 1 },        // amplitude zoom multiplier
})

const canvasEl  = ref(null)
let   lastPcm   = null   // retain last drawn pcm so resize can redraw

watch(() => props.runKey,   () => { lastPcm = null; drawEmpty() })
watch(() => props.pcmFrame, () => draw())
watch(() => [props.color, props.bgColor, props.yZoom], () => lastPcm ? draw() : drawEmpty())

onMounted(() => drawEmpty())

defineExpose({ getCanvas: () => canvasEl.value })

function draw() {
  if (props.pcmFrame?.pcm) lastPcm = props.pcmFrame
  const canvas = canvasEl.value
  if (!canvas) return
  const w = canvas.offsetWidth || canvas.width
  if (canvas.width !== w) canvas.width = w   // only reset when size actually changed
  const ctx = canvas.getContext('2d')
  const h = props.height

  ctx.fillStyle = props.bgColor
  ctx.fillRect(0, 0, w, h)

  const frame = props.pcmFrame ?? lastPcm
  if (!frame?.pcm) { drawEmpty(); return }

  const pcm  = frame.pcm
  const midY = h / 2

  // Filled area above and below center
  ctx.beginPath()
  const r = parseInt(props.color.slice(1, 3), 16)
  const g = parseInt(props.color.slice(3, 5), 16)
  const b = parseInt(props.color.slice(5, 7), 16)
  ctx.fillStyle = `rgba(${r},${g},${b},0.18)`

  ctx.moveTo(0, midY)
  for (let x = 0; x <= w; x++) {
    const idx = Math.floor(x * pcm.length / w)
    const val = Math.max(-midY, Math.min(midY, (pcm[Math.min(idx, pcm.length - 1)] / 32768) * props.yZoom * midY * 0.9))
    ctx.lineTo(x, midY - val)
  }
  ctx.lineTo(w, midY)
  ctx.closePath()
  ctx.fill()

  // Line on top
  ctx.beginPath()
  ctx.strokeStyle = props.color
  ctx.lineWidth = 1.5
  for (let x = 0; x <= w; x++) {
    const idx = Math.floor(x * pcm.length / w)
    const val = Math.max(-midY, Math.min(midY, (pcm[Math.min(idx, pcm.length - 1)] / 32768) * props.yZoom * midY * 0.9))
    x === 0 ? ctx.moveTo(x, midY - val) : ctx.lineTo(x, midY - val)
  }
  ctx.stroke()

  // Center axis
  ctx.beginPath()
  ctx.strokeStyle = `rgba(${r},${g},${b},0.25)`
  ctx.lineWidth = 0.5
  ctx.moveTo(0, midY)
  ctx.lineTo(w, midY)
  ctx.stroke()
}

function drawEmpty() {
  const canvas = canvasEl.value
  if (!canvas) return
  const w = canvas.offsetWidth || canvas.width
  if (canvas.width !== w) canvas.width = w
  const ctx = canvas.getContext('2d')
  const h = props.height

  ctx.fillStyle = props.bgColor
  ctx.fillRect(0, 0, w, h)

  ctx.beginPath()
  ctx.strokeStyle = 'rgba(128,128,128,0.2)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w, h / 2)
  ctx.stroke()
  ctx.setLineDash([])
}
</script>
