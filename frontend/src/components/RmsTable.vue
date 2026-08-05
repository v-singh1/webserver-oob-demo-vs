<template>
  <div class="timing-table-wrap">
    <div v-if="!rows.length" class="placeholder">
      Chunk timing will appear here when running
    </div>
    <template v-else>
      <div class="timing-header">
        <span>Frames</span>
        <span>Pre-Processing (STFT)</span>
        <span>Model Inference (GCRN)</span>
        <span>Post-Processing (ISTFT)</span>
        <span>Total Time</span>
      </div>
      <div class="timing-rows">
        <div v-for="r in rows" :key="r.chunk" class="timing-row">
          <span>{{ r.chunk }}/{{ r.total }}</span>
          <span>{{ r.stft.toFixed(1) }} ms</span>
          <span class="col-tvm">{{ r.tvm.toFixed(1) }} ms</span>
          <span>{{ r.istft.toFixed(1) }} ms</span>
          <span class="col-total">{{ r.totalMs.toFixed(1) }} ms</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
defineProps({ rows: { type: Array, default: () => [] } })
</script>

<style scoped>
.timing-table-wrap {
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
.timing-header, .timing-row {
  display: grid;
  grid-template-columns: 50px 1fr 1fr 1fr 80px;
  padding: 4px 10px;
  gap: 8px;
  align-items: center;
}
.timing-header {
  position: sticky;
  top: 0;
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
  padding-top: 6px;
  padding-bottom: 6px;
}
.timing-row {
  color: #94a3b8;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.col-tvm   { color: #4da6ff; }
.col-total { color: #22c55e; font-weight: 600; }
</style>
