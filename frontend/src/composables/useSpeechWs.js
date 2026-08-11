import { ref, shallowRef, onUnmounted } from 'vue'

export function useSpeechWs() {
  const connected    = ref(false)
  const running      = ref(false)
  const statusMsg    = ref('Idle')
  const statusColor  = ref('secondary')
  const error        = ref(null)
  const chunkTimings   = ref([])         // [{ chunk, total, frameStart, frameEnd, stft, tvm, istft, totalMs }]
  const runKey         = ref(0)          // increments on each new run — canvases watch this to clear history
  const inputPcmFrame  = shallowRef(null)  // latest frame → spectrogram FFT
  const outputPcmFrame = shallowRef(null)
  const inputPcm       = shallowRef(null)  // accumulated signal → waveform
  const outputPcm      = shallowRef(null)
  const inputBuffer    = []              // accumulate all input frames for continuous waveform
  const outputBuffer   = []             // accumulate all output frames
  const downloadUrls = ref(null)
  const metrics      = ref([])
  const MAX_BUFFER_SAMPLES = 16000 * 30  // 30 seconds at 16 kHz

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
        if (msg.totalInputSamples != null && inputBuffer.length > msg.totalInputSamples) {
          inputBuffer.splice(msg.totalInputSamples)
          inputPcm.value = { pcm: new Int16Array(inputBuffer), sampleRate: inputPcm.value?.sampleRate || 16000 }
        }
        if (msg.totalOutputSamples != null && outputBuffer.length > msg.totalOutputSamples) {
          outputBuffer.splice(msg.totalOutputSamples)
          outputPcm.value = { pcm: new Int16Array(outputBuffer), sampleRate: outputPcm.value?.sampleRate || 16000 }
        }
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
      inputPcmFrame.value = { pcm: int16, sampleRate: msg.sampleRate }
      inputBuffer.push(...int16)
      if (inputBuffer.length > MAX_BUFFER_SAMPLES) {
        inputBuffer.splice(0, inputBuffer.length - MAX_BUFFER_SAMPLES)
      }
      inputPcm.value = { pcm: new Int16Array(inputBuffer), sampleRate: msg.sampleRate }
    } else {
      outputPcmFrame.value = { pcm: int16, sampleRate: msg.sampleRate }
      outputBuffer.push(...int16)
      if (outputBuffer.length > MAX_BUFFER_SAMPLES) {
        outputBuffer.splice(0, outputBuffer.length - MAX_BUFFER_SAMPLES)
      }
      outputPcm.value = { pcm: new Int16Array(outputBuffer), sampleRate: msg.sampleRate }
    }
  }

  function reset() {
    runKey.value++
    chunkTimings.value   = []
    metrics.value        = []
    error.value          = null
    downloadUrls.value   = null
    inputPcmFrame.value  = null
    outputPcmFrame.value = null
    inputPcm.value       = null
    outputPcm.value      = null
    inputBuffer.length   = 0
    outputBuffer.length  = 0
    statusMsg.value      = 'Starting…'
    statusColor.value    = 'primary'
    running.value        = true
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

  return { connected, running, statusMsg, statusColor, error, chunkTimings, runKey, inputPcmFrame, outputPcmFrame, inputPcm, outputPcm, downloadUrls, metrics, start, stop }
}
