import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '@/views/Home.vue'
import Logs from '@/views/Logs.vue'
import { routes as deviceRoutes } from '@device/index.js'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/',     redirect: '/home' },
    { path: '/home', component: Home  },
    ...deviceRoutes,
    { path: '/logs', component: Logs  },
  ],
})
