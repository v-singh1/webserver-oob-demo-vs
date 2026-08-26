import { readonly, ref } from 'vue'

const activeDemo = ref(null)
let stopHandler = null
let stopPromise = null

export function registerRunningDemo(name, stop) {
  activeDemo.value = { name }
  stopHandler = stop
}

export function clearRunningDemo(name) {
  if (!activeDemo.value || (name && activeDemo.value.name !== name)) return
  activeDemo.value = null
  stopHandler = null
}

export async function stopRunningDemo() {
  if (!activeDemo.value) return
  if (stopPromise) return stopPromise

  const stop = stopHandler
  stopPromise = Promise.resolve()
    .then(() => stop?.())
    .finally(() => {
      activeDemo.value = null
      stopHandler = null
      stopPromise = null
    })
  return stopPromise
}

export function runningDemoSnapshot() {
  return activeDemo.value
}

export function useDemoSession() {
  return { activeDemo: readonly(activeDemo) }
}
