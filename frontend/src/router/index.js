import { createRouter, createWebHashHistory } from 'vue-router'
import Home           from '@/views/Home.vue'
import AudioDsp       from '@/views/AudioDsp.vue'
import DspCompute     from '@/views/DspCompute.vue'
import ModelInspector from '@/views/ModelInspector.vue'
import Logs           from '@/views/Logs.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/',                 redirect: '/home'            },
    { path: '/home',             component: Home              },
    { path: '/audio-dsp',       component: AudioDsp          },
    { path: '/dsp-compute',     component: DspCompute        },
    { path: '/model-inspector', component: ModelInspector    },
    { path: '/logs',            component: Logs              },
  ],
})
