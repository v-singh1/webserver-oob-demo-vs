import { ref, shallowRef, onUnmounted } from 'vue'

export function useSpeechWs() {
  const connected    = ref(false)
  const running      = ref(false)
  const statusMsg    = ref('Idle')
  const statusColor  = ref('secondary')
  const error        = ref(null)
  const chunkTimings  = ref([])         // [{ chunk, total, frameStart, frameEnd, stft, tvm, istft, totalMs }]
  const runKey        = ref(0)          // increments on each new run — canvases watch this to clear history
  const inputPcm      = shallowRef(null)
  const outputPcm     = shallowRef(null)
  const inputBuffer   = []              // accumulate all input frames for continuous waveform
  const outputBuffer  = []              // accumulate all output frames
  const downloadUrls = ref(null)
  const metrics      = ref([])

  let ws = null

  function connect() {
    if (ws) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/speech`)
    ws.onopen  = () => { connected.value = true }
    ws.onclose = () => { connected.value = false; ws = null }
    ws.onerror = () => { connected.value = false }
    ws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      dispatch(msg)
    }
  }

  function dispatch(msg) {
    switch (msg.type) {
      case 'spectrum':
        handleSpectrum(msg)
        break
      case 'chunk_timing':
        chunkTimings.value = [...chunkTimings.value, {
          chunk: msg.chunk, total: msg.total,
          frameStart: msg.frameStart ?? null, frameEnd: msg.frameEnd ?? null,
          stft: msg.stft, tvm: msg.tvm, istft: msg.istft, totalMs: msg.totalMs,
        }]
        break
      case 'metric':
        metrics.value = [...metrics.value, msg.label]
        statusMsg.value = msg.label
        statusColor.value = 'primary'
        break
      case 'error':
        error.value = msg.message
        statusMsg.value = msg.message
        statusColor.value = 'error'
        running.value = false
        break
      case 'spectrum_done':
        running.value = false
        statusMsg.value = 'Complete'
        statusColor.value = 'success'
        downloadUrls.value = { inputUrl: msg.inputUrl, outputUrl: msg.outputUrl }
        break
      default:
        if (msg.status === 'connected') {
          statusMsg.value = 'Ready'
          statusColor.value = 'secondary'
        }
    }
  }

  function handleSpectrum(msg) {
    const binary = atob(msg.pcm)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const int16  = new Int16Array(bytes.buffer)

    // For waveform: accumulate all frames; for spectrogram: show latest frame only
    if (msg.channel === 'input') {
      inputBuffer.push(...int16)
      inputPcm.value = { pcm: new Int16Array(inputBuffer), sampleRate: msg.sampleRate }
    } else {
      outputBuffer.push(...int16)
      outputPcm.value = { pcm: new Int16Array(outputBuffer), sampleRate: msg.sampleRate }
    }
  }

  function reset() {
    runKey.value++
    chunkTimings.value = []
    metrics.value      = []
    error.value        = null
    downloadUrls.value = null
    inputPcm.value     = null
    outputPcm.value    = null
    statusMsg.value    = 'Starting…'
    statusColor.value  = 'primary'
    running.value      = true
  }

  async function start(filePath) {
    reset()
    const url = filePath ? `/start-speech-enhancement?file=${encodeURIComponent(filePath)}` : '/start-speech-enhancement'
    const r = await fetch(url)
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      error.value = d.error || `HTTP ${r.status}`
      running.value = false
      statusMsg.value = error.value
      statusColor.value = 'error'
    }
  }

  async function stop() {
    await fetch('/stop-speech-enhancement')
    running.value = false
    statusMsg.value = 'Stopped'
    statusColor.value = 'secondary'
  }

  onUnmounted(() => { if (ws) ws.close() })
  connect()

  return { connected, running, statusMsg, statusColor, error, chunkTimings, runKey, inputPcm, outputPcm, downloadUrls, metrics, start, stop }
}
