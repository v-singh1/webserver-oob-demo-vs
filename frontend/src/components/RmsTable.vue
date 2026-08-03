<template>
  <div class="rms-table-wrap">
    <div v-if="!batches.length" class="placeholder">
      RMS values will appear per batch when running
    </div>
    <template v-else>
      <div class="rms-header">
        <span>Batch</span>
        <span>Windows</span>
        <span>Samples</span>
        <span>Bytes</span>
        <span class="col-rms">RMS Variance</span>
      </div>
      <div class="rms-rows">
        <div v-for="b in batches" :key="b.num" class="rms-row">
          <span>{{ b.num }}/{{ b.total }}</span>
          <span>{{ b.windows }}</span>
          <span>{{ b.sampleStart }}–{{ b.sampleEnd }}</span>
          <span>{{ b.bytes }}</span>
          <span class="col-rms" :style="{ color: rmsColor(b.value) }">
            {{ b.value.toFixed(4) }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
defineProps({ batches: { type: Array, default: () => [] } })

function rmsColor(v) {
  if (v < 0.2) return '#22c55e'
  if (v < 0.5) return '#f59e0b'
  return '#ef4444'
}
</script>

<style scoped>
.rms-table-wrap {
  background: rgb(var(--v-theme-surface-variant));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
  min-height: 80px;
  max-height: 160px;
  font-size: 11px;
  overflow-y: auto;
}
.placeholder {
  color: #475569;
  text-align: center;
  padding: 16px 0;
}
.rms-header, .rms-row {
  display: grid;
  grid-template-columns: 60px 60px 1fr 60px 90px;
  padding: 4px 10px;
  gap: 8px;
  align-items: center;
}
.rms-header {
  position: sticky;
  top: 0;
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
  padding-top: 6px;
  padding-bottom: 6px;
}
.rms-row {
  color: #94a3b8;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.col-rms { color: #4da6ff; }
</style>
