import { ref, onMounted, onUnmounted } from 'vue'

export function useCpuStats() {
  const cpu     = ref(0)
  const ramUsed = ref('—')
  const ramFree = ref('—')
  const uptime  = ref('—')
  let timers = []

  function fmtMb(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB' }
  function fmtUptime(s) {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
    return `${d}d ${h}h ${m}m`
  }

  async function pollCpu() {
    try {
      const d = await fetch('/cpu-load').then(r => r.json())
      const v = d.current_cpu_usage ?? d.cpu_percent ?? null
      if (v != null) cpu.value = Math.round(v)
    } catch { /* board unreachable */ }
  }

  async function pollMem() {
    try {
      const d = await fetch('/mem-info').then(r => r.json())
      if (!d.total_kb) return
      const used  = Math.round((d.total_kb - d.available_kb) / 1024)
      const total = Math.round(d.total_kb / 1024)
      ramUsed.value = fmtMb(used)
      ramFree.value = fmtMb(total - used)
    } catch { /* board unreachable */ }
  }

  async function pollUptime() {
    try {
      const d = await fetch('/sys-uptime').then(r => r.json())
      if (d.uptime_seconds != null) uptime.value = fmtUptime(d.uptime_seconds)
    } catch { /* board unreachable */ }
  }

  onMounted(() => {
    pollCpu(); pollMem(); pollUptime()
    timers.push(setInterval(pollCpu,    1000))
    timers.push(setInterval(pollMem,    5000))
    timers.push(setInterval(pollUptime, 10000))
  })
  onUnmounted(() => timers.forEach(clearInterval))

  return { cpu, ramUsed, ramFree, uptime }
}
