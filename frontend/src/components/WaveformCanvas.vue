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
})

const canvasEl = ref(null)

watch(() => props.pcmFrame, () => draw())
watch(() => [props.color, props.bgColor], () => props.pcmFrame ? draw() : drawEmpty())

onMounted(() => drawEmpty())

function draw() {
  const canvas = canvasEl.value
  if (!canvas) return
  const w = canvas.offsetWidth || canvas.width
  canvas.width = w
  const ctx = canvas.getContext('2d')
  const h = props.height

  ctx.fillStyle = props.bgColor
  ctx.fillRect(0, 0, w, h)

  if (!props.pcmFrame?.pcm) { drawEmpty(); return }

  const pcm  = props.pcmFrame.pcm
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
    const val = (pcm[Math.min(idx, pcm.length - 1)] / 32768) * midY * 0.9
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
    const val = (pcm[Math.min(idx, pcm.length - 1)] / 32768) * midY * 0.9
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
  canvas.width = w
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
