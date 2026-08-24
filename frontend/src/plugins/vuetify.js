import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

export default createVuetify({
  components,
  directives,
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  theme: {
    defaultTheme: 'tiDark',
    themes: {
      tiDark: {
        dark: true,
        colors: {
          background:       '#0a0e1a',
          surface:          '#0d1117',
          'surface-bright': '#111827',
          'surface-variant':'#05080f',
          primary:          '#4da6ff',
          secondary:        '#94a3b8',
          success:          '#22c55e',
          error:            '#ef4444',
          warning:          '#f59e0b',
          info:             '#60a5fa',
          'on-background':  '#e2e8f0',
          'on-surface':     '#e2e8f0',
        },
        variables: {
          'border-color':   '#1e2a3a',
          'border-opacity': 1,
          'medium-emphasis-opacity': 0.7,
          'high-emphasis-opacity':   1,
        },
      },
      tiLight: {
        dark: false,
        colors: {
          background:       '#f0f4f8',
          surface:          '#ffffff',
          'surface-bright': '#f8fafc',
          'surface-variant':'#f1f5f9',
          primary:          '#1d6fe8',
          secondary:        '#475569',
          success:          '#16a34a',
          error:            '#dc2626',
          warning:          '#d97706',
          info:             '#2563eb',
          'on-background':  '#0f172a',
          'on-surface':     '#0f172a',
        },
        variables: {
          'border-color':   '#e2e8f0',
          'border-opacity': 1,
        },
      },
    },
  },
})
