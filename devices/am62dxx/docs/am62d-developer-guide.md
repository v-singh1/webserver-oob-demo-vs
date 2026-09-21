<a id="top"></a>

Texas Instruments

# AM62D Developer Guide

**Source baseline:** upstream `main`, commit [`60d434b`](https://github.com/TexasInstruments/webserver-oob-demo/commit/60d434b4dbb3b45d53862864da7f38b0a5867acb) (21 September 2026).

Companion guide: [AM62D User Guide](am62d-user-guide.md).

This guide describes the repository implementation at that revision. Target firmware, model artifacts, SDK packaging, and measured performance depend on the installed SDK. The documentation update was checked against source; it is not an EVM validation report.

Developer Guide

**Declared reference SDK** 12.02.00.03

**TIDL** 11.02.16.00

**MCU+ SDK** 12.02.00.01

## Contents

- [Architecture Overview](#architecture)
- [Repository Structure](#repo-structure)
- [Plugin API](#plugin-api)
- [Adding a New Demo](#new-demo)
- [Adding a New Device](#new-device)
- [GStreamer Pipeline Development](#gstreamer)
- [Frontend Development (Vue/Vuetify)](#frontend)
- [Local Development](#local-dev)
- [Build System (Makefile)](#build-system)
- [Deployment (Manual SSH)](#deployment)
- [Yocto Recipe (meta-tisdk)](#yocto)
- [REST API Reference (AM62D)](#api-reference)

<a id="architecture"></a>

## Architecture Overview

The portal is a plugin-based web server backed by an Express/WebSocket Node.js process and a Vue 3 + Vuetify single-page application. Device-specific behavior is isolated in per-device and per-demo plugins, keeping the common server and frontend shell device-agnostic.

### Component Layers

| Layer | Components | Role |
|---|---|---|
| Browser | Vue/Vuetify shell, device views, shared classification view | Controls, status, PCM visualization, result playback and exports |
| Web server | Express/WebSocket, device plugin, demo plugins | REST routes, lifecycle management, streaming |
| Coordination | `demos/demo-coordinator.js` | C7x ownership, requesting-client ownership, TVM readiness and model-cache handling |
| AM62D speech/classification | `/usr/bin/rpmsg_inference_example` plus pipeline JSON | Native RPMsg-DMA processing and TVM/TIDL inference |
| Custom pipeline | `gst-launch-1.0` and installed TI plugins | User-selected GStreamer pipelines |
| DSP offload demos | RPMsg audio, 2D FFT and sigchain applications | Dedicated DSP workloads |

### AM62D Speech Runtime

Configuration comes from `demoConfig.speech-enhancement` in `devices/am62dxx/device.json`:

| Key | Current configuration |
|---|---|
| `edgeAiBinary` | `/usr/bin/rpmsg_inference_example` |
| `tvmDir` | `/usr/share/tvm_inference` |
| `jsonFile` | `json/pipeline_speech_enhancement.json` |
| `inputPath` | `/usr/share/tvm_inference/input/input_audio.wav` |
| `streamSocket` | `/tmp/edge-ai-speech.sock` |
| `outputName` | `processed_output.wav` |

The server validates input PCM, acquires DSP ownership, writes a per-job JSON overriding `input_file`, ensures preload as needed, and spawns the native binary with that JSON as its argument. It parses timing output and forwards native PCM from the Unix socket to `/speech`. Successful completion publishes WAV URLs and exact sample counts. This path does not send the older interactive `pipeline`, `run`, or `quit` commands to stdin.

The pipeline JSON's `artifacts_path` and installed native application must match the deployed model. A successful frontend build does not prove model inference works. The older demo README's companion-fork instructions and STFT-only limitation are not an authoritative statement about the currently deployed binary; check its version and actual pipeline implementation.

### DSP Ownership and TVM Readiness

Use `acquireDsp(demoName, ownerIp)` and release ownership on completion, failure, and cancellation. Stop routes check the requesting client IP through the coordinator. Do not start competing demos concurrently on the same DSP.

Model-cache handling distinguishes already loaded artifacts from model changes. The speech client uses `--preload` when required. Classification is configured with `preloadTvm: false`; its native path handles the selected classification model. The Audio Intelligence view polls readiness and reports an initial timeout after 90 seconds.

### Startup Sequence

1.  ### systemd loads configuration

    The `webserver-oob.service` unit reads `/etc/webserver-oob.conf`, which sets `APP_DIR`, `DEVICE_CONFIG`, and `DEMOS_DIR` environment variables before launching `server.js`.

2.  ### server.js reads device.json

    `DEVICE_CONFIG` points to the device JSON. The server parses it for the demo list, UI mode (`"vue"` vs `"legacy"`), and demo-specific config blocks.

3.  ### Device plugin loaded

    The server `require()`s `server-plugin.js` from the same directory as `device.json`, passing `(app, wss, device)`. This registers device-level REST routes.

4.  ### Demo plugins loaded

    For each demo ID in `device.demos`, the server loads `$DEMOS_DIR/<id>/server-plugin.js`. Plugins register their own routes and WebSocket handlers.

5.  ### Static assets served

    For Vue devices, the built SPA at `APP_DIR/vue-dist/` is served as a catch-all. Non-Vue devices serve the legacy GUI-Composer HTML at `APP_DIR/index.html`.

### Key Environment Variables

| Variable      | EVM Path / Default                     | Purpose                                                         |
|---------------|----------------------------------------|-----------------------------------------------------------------|
| APP_DIR       | `/usr/share/webserver-oob/app`         | Vue dist root and device assets (images, etc.)                  |
| DEVICE_CONFIG | `/usr/share/webserver-oob/device.json` | Path to device metadata JSON (required)                         |
| DEMOS_DIR     | `/usr/share/webserver-oob/demos`       | Directory containing per-demo plugin subdirectories             |
| PORT          | `3000`                                 | HTTP/WebSocket listen port (nginx proxies 80 → 3000)            |
| MOCK          | `0`                                    | Set to `1` to run without hardware (all hardware calls stubbed) |

<a id="repo-structure"></a>

## Repository Structure

    common/
      webserver/        # server.js, webserver-oob.service, webserver-oob.conf
      linux_app/        # cpu_stats.c, audio_utils.c (shared C utilities)
      app/              # Legacy frontend (index.html, components submodule)

    demos/
      cpu-monitor/      # server-plugin.js + manifest.json
      audio-classification/
      speech-enhancement/
      audio-offload/
      2dfft/
      sigchain-biquad/
      gst-pipeline/
      tvm-inference/
      benchmark/
      speech-to-text/

    devices/
      am62dxx/
        device.json           # Device metadata and demo config
        server-plugin.js      # Device REST endpoints
        linux_app/            # audio_utils.c, speech_utils.c, Makefile
        app/
          images/             # Board images
          vue-dist/           # Built Vue frontend (Vite output) ← deploy target
        ui/
          index.js            # Routes, navItems, deviceTitle, demoCards
          views/
            AudioDsp.vue      # Audio Intelligence page
            DspCompute.vue    # DSP Acceleration page
            ModelInspector.vue
          demos/
            SpeechEnhancement.vue
            AudioOffload.vue
            2DFft.vue
            SigchainBiquad.vue
            GStreamerPipeline.vue
            TvmInference.vue

    frontend/
      src/
        App.vue             # Shell: sidebar, app-bar, power controls, router-view
        main.js             # Vue app init, plugin registration, device UI import
        views/
          Home.vue          # Home/landing page
          Logs.vue          # Server log stream view
        components/
          AudioPlayer.vue
          SpectrogramCanvas.vue
          SpectrumCanvas.vue
          WaveformCanvas.vue
          RmsTable.vue
      vite.config.js        # Build config (outDir, base, proxy, @device alias)
      package.json

    docs/
      am62d-user-guide.md
      am62d-developer-guide.md
      am62d-demo-guide.html
      am62d-howto-guide.html

    tools/
      generate-inc.js       # Regenerates webserver-oob-npm.inc for Yocto
      generate-frontend-inc.js

    Makefile

<a id="plugin-api"></a>

## Plugin API

Every `server-plugin.js` — whether device-level or demo-level — exports a single function with the following signature:

``` javascript
module.exports = function registerPlugin(app, wss, device) {
  // app    — Express application instance
  // wss    — WebSocket server (ws library)
  // device — Parsed device.json object
}
```

### Plugin Arguments

| Argument | Type      | Description                                                                   |
|----------|-----------|-------------------------------------------------------------------------------|
| `app`    | Express   | Standard Express app. Use `app.get()`, `app.post()`, etc. to register routes. |
| `wss`    | ws.Server | WebSocket server. Subscribe to `'connection'` and filter by `req.url`.        |
| `device` | Object    | Parsed `device.json`. Access per-demo config via `device.demoConfig['<id>']`. |

### Demo manifest.json Fields

| Field         | Type       | Description                                                                          |
|---------------|------------|--------------------------------------------------------------------------------------|
| `id`          | string     | Must match the demo directory name. Used as the demo key throughout the system.      |
| `name`        | string     | Human-readable display name shown in the UI.                                         |
| `description` | string     | Short description shown in demo cards.                                               |
| `devices`     | string\[\] | `["*"]` for all devices, or an array of device IDs (e.g. `["am62dxx"]`).             |
| `routes`      | string\[\] | REST path prefixes this plugin registers. Used for documentation and route auditing. |
| `websocket`   | string     | WebSocket URL path this plugin handles (optional). E.g. `"/speech"`.                 |

### WebSocket Handler Pattern

Because all demos share a single `wss` instance, filter connections by `req.url`:

``` javascript
wss.on('connection', (ws, req) => {
  if (req.url !== '/my-ws') return   // ignore connections for other demos

  ws.send(JSON.stringify({ type: 'connected' }))

  ws.on('message', data => {
    const msg = JSON.parse(data)
    // handle incoming messages
  })

  ws.on('close', () => {
    // cleanup: kill spawned processes, release resources
  })
})
```

### Mock Mode Pattern

Read `MOCK` once at module load and short-circuit all hardware calls. This allows the full frontend to run on a developer laptop without a board attached.

``` javascript
const MOCK = process.env.MOCK === '1'

app.get('/my-demo/status', (req, res) => {
  if (MOCK) return res.json({ status: 'mock', device: 'simulated' })

  // real hardware path
  res.json({ status: 'ok' })
})
```

**Tip** Mock stubs should return the same JSON shape as real responses so the Vue components work identically in both modes. Never return an empty object when the component expects specific fields.

### Spawning Native Processes

Demo plugins typically spawn a native binary (GStreamer, audio utility, etc.) and stream its stdout/stderr to the browser over WebSocket:

``` javascript
const { spawn } = require('child_process')
let proc = null

app.get('/my-demo/start', (req, res) => {
  if (proc) return res.status(409).json({ error: 'already running' })

  proc = spawn('/usr/bin/my_util', ['--arg', req.query.device])

  proc.stdout.on('data', chunk => {
    // broadcast to all connected WebSocket clients on this path
    wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN && ws._url === '/my-ws')
        ws.send(JSON.stringify({ type: 'data', payload: chunk.toString() }))
    })
  })

  proc.on('exit', code => { proc = null })
  res.json({ started: true })
})

app.get('/my-demo/stop', (req, res) => {
  if (proc) { proc.kill('SIGTERM'); proc = null }
  res.json({ stopped: true })
})
```

<a id="new-demo"></a>

## Adding a New Demo

Follow these steps in order. The system auto-discovers demo plugins at startup — no changes to `server.js` are needed.

1.  ### Create the demo directory and manifest

    ``` bash
    mkdir -p demos/my-demo
    ```

    Create `demos/my-demo/manifest.json`:

    ``` json
    {
      "id": "my-demo",
      "name": "My Demo",
      "description": "What this demo does.",
      "devices": ["am62dxx"],
      "routes": ["/my-demo"],
      "websocket": "/my-demo-ws"
    }
    ```

2.  ### Write server-plugin.js

    ``` javascript
    'use strict'
    const MOCK = process.env.MOCK === '1'

    module.exports = function registerMyDemo(app, wss, device) {
      const cfg = (device.demoConfig || {})['my-demo'] || {}

      app.get('/my-demo/status', (req, res) => {
        if (MOCK) return res.json({ status: 'mock' })
        res.json({ status: 'ok', config: cfg })
      })

      app.post('/my-demo/run', (req, res) => {
        // spawn process, stream output via WebSocket
        res.json({ started: true })
      })

      wss.on('connection', (ws, req) => {
        if (req.url !== '/my-demo-ws') return
        ws.send(JSON.stringify({ type: 'connected' }))
        ws.on('message', data => { /* handle */ })
        ws.on('close', () => { /* cleanup */ })
      })

      console.log('[my-demo] registered' + (MOCK ? ' (MOCK)' : ''))
    }
    ```

3.  ### Register in device.json

    Add the demo ID to the `demos` array and provide any per-demo config:

    ``` json
    {
      "demos": ["cpu-monitor", "my-demo"],
      "demoConfig": {
        "my-demo": { "binPath": "/usr/bin/my_util" }
      }
    }
    ```

4.  ### Create the Vue component

    Create `devices/am62dxx/ui/demos/MyDemo.vue`. Every demo component must expose `run()`, `stop()`, and `isRunning` so the parent view can control it:

    ``` vue
    <template>

        
          My Demo
          <!-- your UI -->

      
    </template>

    <script setup>
    import { ref } from 'vue'
    const result = ref(null)
    const isRunning = ref(false)

    async function run() {
      isRunning.value = true
      const r = await fetch('/my-demo/run', { method: 'POST' })
      result.value = await r.json()
    }

    function stop() {
      fetch('/my-demo/stop')
      isRunning.value = false
    }

    defineExpose({ run, stop, isRunning })
    </script>
    ```

5.  ### Wire into a page view

    Add the component to the appropriate view — `AudioDsp.vue` for audio demos, `DspCompute.vue` for DSP compute demos, or create a new view. Import the component and add it to the demo list array:

    ``` javascript
    // In AudioDsp.vue (or your target view):
    import MyDemo from '@device/demos/MyDemo.vue'

    const demos = [
      // ... existing demos ...
      {
        name: 'My Demo',
        description: 'What this demo does.',
        icon: 'mdi-tune',
        component: MyDemo
      }
    ]
    ```

    The view's active component is selected by index (`demos[activeIdx].component`), so no additional wiring is needed.

6.  ### Add Vite dev proxy (dev mode only)

    In `frontend/vite.config.js`, add entries for the new demo's routes so the dev server forwards them to the backend:

    ``` javascript
    // frontend/vite.config.js
    proxy: {
      '/my-demo': BACKEND,
      '/my-demo-ws': { target: 'ws://localhost:3000', ws: true },
      // ... existing entries
    }
    ```

7.  ### Test with mock mode

    ``` bash
    # Mock Node.js backend; start Vite separately as described in Local Development
    make dev DEVICE=am62dxx MOCK=1

    # Or start components individually:
    cd common/webserver && MOCK=1 DEVICE_CONFIG=../../devices/am62dxx/device.json node server.js &
    (cd frontend && VITE_DEVICE=am62dxx npm run dev)
    # Open http://localhost:5173
    ```

    **Done** The new demo appears automatically in the navigation once device.json lists its ID and the server loads its plugin.

<a id="new-device"></a>

## Adding a New Device

A "device" in this portal is a target board with its own set of demos, UI layout, and optional native utilities. Devices are fully self-contained under `devices/<id>/`.

1.  ### Create the device directory structure

    ``` bash
    mkdir -p devices/<id>/app/images
    mkdir -p devices/<id>/linux_app
    mkdir -p devices/<id>/ui/views
    mkdir -p devices/<id>/ui/demos
    ```

2.  ### Create device.json

    Set `"ui": "vue"` for the Vue/Vuetify frontend or `"legacy"` for the older GUI-Composer HTML frontend.

    ``` json
    {
      "id": "am62xx",
      "ui": "legacy",
      "displayName": "AM62X Starter Kit",
      "boards": [
        {
          "name": "SK-AM62",
          "description": "Sitara AM625 Evaluation Module",
          "image": "images/sk-am62.png"
        }
      ],
      "soc": "AM625 Cortex-A53 @ 1.4 GHz",
      "demos": ["cpu-monitor", "audio-classification"],
      "demoConfig": {
        "audio-classification": {
          "defaultModel": "yamnet"
        }
      }
    }
    ```

3.  ### Create device server-plugin.js (optional)

    Only needed if the device requires device-specific REST endpoints (power control, model management, custom hardware queries, etc.).

    ``` javascript
    'use strict'
    module.exports = function registerDevice(app, wss, device) {
      app.get('/device-status', (req, res) => {
        res.json({ id: device.id, soc: device.soc, ok: true })
      })

      app.post('/system/reboot', (req, res) => {
        res.json({ ok: true })
        setTimeout(() => require('child_process').exec('reboot'), 500)
      })
    }
    ```

4.  ### Add native utilities (if required)

    Create `devices/<id>/linux_app/Makefile`:

    ``` makefile
    include ../../../common/linux_app/Makefile.common

    TARGETS = my_utils

    my_utils: my_utils.c
        $(CC) $(CFLAGS) my_utils.c -o my_utils $(LDFLAGS)

    all: $(TARGETS)

    clean:
        rm -f $(TARGETS)
    ```

5.  ### Add Vue UI (if ui: "vue")

    Create `devices/<id>/ui/index.js` exporting the required fields. All of these are consumed by `frontend/src/main.js` at build time via the `@device` alias:

    ``` javascript
    // devices/<id>/ui/index.js
    import MyView from './views/MyView.vue'

    export const routes = [
      { path: '/', redirect: '/home' },
      { path: '/my-view', component: MyView },
    ]

    export const navItems = [
      { icon: 'mdi-home', title: 'Home', to: '/home' },
      { icon: 'mdi-tune', title: 'My Feature', to: '/my-view' },
    ]

    export const deviceTitle = 'AM62X'
    export const connectedLabel = 'SK-AM62 Connected'
    export const heroDesc = 'Short description for the landing page.'
    export const heroButton = { label: 'Get Started', to: '/my-view' }
    export const demoCards = []      // optional: override home page cards
    export const sdkInfo = []        // SDK version badges
    export const chipImages = []     // chip/board images for About page
    export const aboutText = ''      // markdown-ish about text
    ```

6.  ### Create the Yocto recipe entry

    In `meta-tisdk_vs/.../webserver-oob_git.bb`, extend compatibility and add device-specific dependencies:

    ``` bitbake
    COMPATIBLE_MACHINE = "...|<id>"
    DEVICE_ID:<id> = "<id>"
    RDEPENDS:${PN}:<id> = "nodejs gstreamer1.0-plugins-bad"
    ```

7.  ### Build and test

    ``` bash
    # Cross-compile native utilities
    make build DEVICE=<id> CC=aarch64-linux-gnu-gcc

    # Build Vue frontend (if ui: "vue")
    make build-frontend DEVICE=<id>

    # Deploy to board
    make deploy DEVICE=<id> BOARD_HOST=root@<ip>

    # Test locally with no hardware
    make dev DEVICE=<id> MOCK=1
    ```

<a id="gstreamer"></a>

## GStreamer Pipeline Development

The examples in this section describe the custom GStreamer path, not the dedicated RPMsg demo backend. Confirm element/property availability with `gst-inspect-1.0 tidspkernel` and `gst-inspect-1.0 titvm` on the target. Plugin properties, tensor shapes and artifact paths must match the installed SDK; these commands were not executed on an EVM for this documentation revision.

### 6.1 TI GStreamer Elements

#### tidspkernel

Offloads DSP operations (STFT, ISTFT, interleave/deinterleave) to the AM62D C7x DSP core.

| Property        | Values / Description                                                            |
|-----------------|---------------------------------------------------------------------------------|
| `msg-type`      | `0x1020` = STFT  \|  `0x1030` = ISTFT  \|  `0x1040` = deinterleave/interleave   |
| `model-path`    | Path to TVM artifact directory (e.g. `/usr/share/tvm_inference/artifacts/gcrn`) |
| `hop-size`      | Hop size in samples (e.g. `160` for 10ms at 16 kHz)                             |
| `fft-size`      | FFT frame size in samples (e.g. `320`)                                          |
| `window-frames` | Number of frames in the processing window (e.g. `401`)                          |
| `batch-size`    | Number of frames per DSP batch call (e.g. `64`)                                 |
| `param2`        | `0` = deinterleave  \|  `1` = interleave (used with `msg-type=0x1040`)          |

#### titvm

Runs TVM-compiled model inference on the AM62D's MMA/C7x accelerator.

| Property         | Description                                                                  |
|------------------|------------------------------------------------------------------------------|
| `model-path`     | TVM artifact directory (must contain compiled model and `mod.json`)          |
| `class-map-path` | Path to label list file (one label per line; used for classification output) |
| `top-k`          | Number of top-scoring classes to output (e.g. `3`)                           |

### 6.2 Speech Enhancement Pipeline (GCRN)

Full STFT → TVM inference (GCRN) → ISTFT chain. Reads a noisy WAV, writes a denoised WAV, and plays back via ALSA simultaneously.

``` bash
gst-launch-1.0 -v \
  filesrc location=/usr/share/tvm_inference/input/input_audio.wav ! \
  wavparse ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! \
  tidspkernel name=stft msg-type=0x1020 \
    model-path=/usr/share/tvm_inference/artifacts/gcrn \
    hop-size=160 fft-size=320 window-frames=401 batch-size=64 ! \
  tidspkernel name=deinterleave msg-type=0x1040 param2=0 \
    model-path=/usr/share/tvm_inference/artifacts/gcrn \
    fft-size=320 window-frames=401 ! \
  titvm model-path=/usr/share/tvm_inference/artifacts/gcrn ! \
  tidspkernel name=interleave msg-type=0x1040 param2=1 \
    model-path=/usr/share/tvm_inference/artifacts/gcrn \
    fft-size=320 window-frames=401 ! \
  tidspkernel name=istft msg-type=0x1030 \
    model-path=/usr/share/tvm_inference/artifacts/gcrn \
    hop-size=160 fft-size=320 window-frames=401 batch-size=64 ! \
  audio/x-raw,format=S16LE,rate=16000,channels=1 ! \
  tee name=t ! \
  queue ! wavenc ! filesink location=/tmp/gst_enhanced.wav \
  t. ! queue ! audioconvert ! audioresample ! autoaudiosink
```

### 6.3 Audio Classification — Live Microphone (YAMNet)

``` bash
gst-launch-1.0 -v \
  alsasrc device=hw:0,0 ! \
  audioconvert ! audioresample ! \
  audio/x-raw,format=S16LE,rate=16000,channels=1 ! \
  tidspkernel name=stft msg-type=0x1020 \
    model-path=/usr/share/tvm_inference/artifacts/yamnet \
    hop-size=160 window-frames=96 batch-size=64 ! \
  titvm model-path=/usr/share/tvm_inference/artifacts/yamnet \
    class-map-path=/usr/share/tvm_inference/labels/yamnet_label_list.txt \
    top-k=3 ! \
  fakesink
```

### 6.4 Audio Classification — File Input (VGGish)

``` bash
gst-launch-1.0 \
  filesrc location=/usr/share/tvm_inference/input/urbansound_16k.wav ! \
  wavparse ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! \
  tidspkernel name=stft msg-type=0x1020 \
    model-path=/usr/share/tvm_inference/artifacts/vggish/ \
    hop-size=160 window-frames=126 batch-size=64 ! \
  titvm model-path=/usr/share/tvm_inference/artifacts/vggish/ \
    class-map-path=/usr/share/tvm_inference/labels/vggish_label_list.txt \
    top-k=3 ! \
  filesink location=vggish_inference_output.bin
```

### 6.5 TVM Artifact Directory Structure

    /usr/share/tvm_inference/
      artifacts/
        yamnet/         # compiled YAMNet TVM model (audio classification)
        vggish/       # compiled VGGish TVM model (audio classification)
        gcrn/           # compiled GCRN model (speech enhancement)
      labels/
        yamnet_label_list.txt
        vggish_label_list.txt
      input/
        input_audio.wav         # sample noisy speech (16 kHz mono)
        urbansound_16k.wav      # sample urban sounds (16 kHz mono)

### 6.6 Uploading Custom Artifacts via the Portal

1.  Package your TVM model: `tar -czf my_model.tar.gz -C my_model .`
2.  Open the portal → **Custom Audio Pipeline** → **TVM Artifacts** → **Upload Archive**.
3.  The archive is extracted to `/usr/share/tvm_inference/artifacts/my_model/`.
4.  Click **Refresh**, then **Use** to insert the artifact path directly into the pipeline command field.

**Model Compatibility** TVM artifacts must be compiled for the AM62D C7x/MMA target using a compiler/artifact format compatible with the deployed TIDL/TVM runtime. Models compiled for other targets (x86, ARM NEON, etc.) will fail to load. Use the TI Edge AI model conversion tools documented in the TIDL user guide.

### 6.7 Extending the gst-pipeline Demo Plugin

`demos/gst-pipeline/server-plugin.js` handles all `/gst/*` REST routes and the `/gst` WebSocket. Common extension points:

- Add custom preprocessing REST endpoints before pipeline execution.
- Preserve the existing ZIP, tar.gz and tgz handling and extraction-size checks when extending uploads.
- Preserve existing command validation and direct spawning when extending `POST /gst/run`.
- Emit structured metrics (latency, throughput) via the `/gst` WebSocket using a new message type.

<a id="frontend"></a>

## Frontend Development (Vue/Vuetify)

### 7.1 Prerequisites

- Node.js 18 or later
- `cd frontend && npm install`
- Vite 5.x (installed as a dev dependency)

### 7.2 Starting the Dev Server

``` bash
# Node.js backend only; start Vite in another terminal
make dev DEVICE=am62dxx

# Or start components individually:
# Terminal 1 — Node.js backend
cd common/webserver
DEVICE_CONFIG=../../devices/am62dxx/device.json node server.js

# Terminal 2 — Vite dev server
(cd frontend && VITE_DEVICE=am62dxx npm run dev)
# Open http://localhost:5173
```

### 7.3 Building for Production

``` bash
(cd frontend && VITE_DEVICE=am62dxx npm run build)
# Output: devices/am62dxx/app/vue-dist/
# This directory is what gets deployed to the EVM.
```

**Note** The Vite build reads the `VITE_DEVICE` environment variable (set in `package.json` scripts or `make build-frontend`) to resolve the `@device` alias. Ensure the correct device is set before building.

### 7.4 The @device Alias

In `vite.config.js`, the alias `@device` resolves to `devices/${DEVICE}/ui/`. This is the mechanism that makes the shared frontend shell device-agnostic while still importing device-specific views and demo components at build time.

``` javascript
// Usage in shared frontend code:
import * as DeviceIndex from '@device/index.js'        // device route/nav config
import AudioDsp    from '@device/views/AudioDsp.vue'
import MyDemo      from '@device/demos/MyDemo.vue'
```

### 7.5 Theme System

The app ships two Vuetify themes: `tiDark` (default) and `tiLight`. Users toggle between them with the sun/moon icon in the app bar. Canvas-based visualizations (waveform, spectrogram, spectrum) must detect the active theme to adjust colors:

``` vue
<script setup>
import { computed } from 'vue'
import { useTheme } from 'vuetify'

const theme = useTheme()
const isLight = computed(() => theme.global.name.value === 'tiLight')
const bgColor  = computed(() => isLight.value ? '#ffffff' : '#141824')
const lineColor = computed(() => isLight.value ? '#1a1d27' : '#60a5fa')
</script>
```

### 7.6 Adding a New View/Page

1.  Create `devices/am62dxx/ui/views/MyView.vue`

2.  Add a route in `devices/am62dxx/ui/index.js`:

    ``` javascript
    { path: '/my-view', component: () => import('./views/MyView.vue') }
    ```

3.  Add a navigation item:

    ``` javascript
    { icon: 'mdi-tune', title: 'My View', to: '/my-view' }
    ```

### 7.7 Speech Visualization and Playback Components

| Component | Relevant props / behavior |
|---|---|
| `WaveformCanvas` | `pcmFrame`, `color`, `bgColor`, `height`, `runKey`, `yZoom`, `cursorTime`; PCM waveform and cursor |
| `SpectrogramCanvas` | `pcmFrame`, `colorMap`, `bgColor`, `height`, `runKey`, `maxCols`, `floorDb`, `scaleMode`, `cursorTime`; PCM-derived spectral history |
| `AudioPlayer` | `url`, `label`, `accent`; metadata loading, playback state, seeking and progress |

Use `frontend/src/composables/useSpeechWs.js` for the speech message contract and `frontend/src/utils/speechVisualization.js` for signal processing. The browser derives plots from PCM; the `spectrum` message name does not mean its payload is FFT bins. On completion, the frontend can rebuild plots from full WAV data and trim padded samples using completion metadata.

`AudioPlayer.vue` uses media events and an animation clock while playing. Pause, source replacement, error, and component teardown stop the clock. The WAV endpoint uses `sendFile`, byte-range support, and `Cache-Control: no-store`. Keep these behaviors when changing result serving or introducing a reverse proxy.

The speech view can export available plot PNGs, timing CSV and input/output WAVs using JSZip. Each spectrogram can use relative peak normalization or a shared reference; use the latter for level comparisons.

### 7.8 WebSocket Usage in Components

The standard pattern for opening a WebSocket to a demo endpoint and handling message routing:

``` vue
<script setup>
import { ref, onUnmounted } from 'vue'

const isRunning = ref(false)
let ws = null

function run() {
  isRunning.value = true
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${scheme}//${location.host}/my-demo-ws`)

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'data')   handleData(msg.payload)
    if (msg.type === 'error')  handleError(msg.message)
    if (msg.type === 'exit')   { isRunning.value = false }
  }

  ws.onclose = () => { isRunning.value = false }
  fetch('/my-demo/run', { method: 'POST' })
}

function stop() {
  fetch('/my-demo/stop')
  ws?.close()
  isRunning.value = false
}

onUnmounted(stop)   // clean up if user navigates away

defineExpose({ run, stop, isRunning })
</script>
```

<a id="local-dev"></a>

## Local Development

### 8.1 Mock Mode — No Hardware Required

From the repository root, build the frontend and start the backend:

```bash
make build-frontend DEVICE=am62dxx
make dev DEVICE=am62dxx MOCK=1
```

The backend serves the built Vue application on port 3000. `make dev` starts Node.js only; it does not start Vite. For hot reload, keep that backend running and use another terminal:

```bash
cd frontend
npm install
VITE_DEVICE=am62dxx npm run dev
```

Open the Vite URL (normally port 5173). Mock mode supports offline UI exercise with synthetic responses where implemented. It is not a substitute for target DSP, ALSA, firmware, inference, or performance validation.

### 8.2 With Target Hardware (Remote EVM)

Run the Node.js server on the EVM (or forward its port via SSH), then point the Vite dev server's proxy at the EVM IP:

``` bash
# On your dev machine — forward EVM port 3000 locally
ssh -L 3000:localhost:3000 root@<EVM_IP>

# Start Vite (proxy targets localhost:3000 → tunneled to EVM)
(cd frontend && VITE_DEVICE=am62dxx npm run dev)
```

### 8.3 Environment Variables

| Variable      | Default                    | Description                                                                                 |
|---------------|----------------------------|---------------------------------------------------------------------------------------------|
| PORT          | `3000`                     | HTTP/WebSocket listen port.                                                                 |
| DEVICE_CONFIG | (required)                 | Absolute path to `device.json`.                                                             |
| APP_DIR       | Derived from DEVICE_CONFIG | Root directory for Vue dist and static assets. Defaults to same directory as `device.json`. |
| DEMOS_DIR     | Derived                    | Directory containing demo plugin subdirectories. Defaults to `<repo-root>/demos`.           |
| MOCK          | `0`                        | Set to `1` to stub all hardware I/O.                                                        |

### 8.4 Unit and Offline GUI Tests

From the repository root:

```bash
(cd common/webserver && npm install && npm test)
```

`npm test` runs `node ../../test/run.js`. The frontend package defines `dev`, `build`, and `preview`; it does not define Jest, lint, or type-check commands.

For the offline GUI suite:

```bash
(cd frontend && npm install && VITE_DEVICE=am62dxx npm run build)
python3 -m pip install -r tests/gui/requirements.txt
rfbrowser init chromium
WEBSERVER_OOB_DEMO_ROOT="$PWD" robot --outputdir robot-results \
  --loglevel INFO tests/gui/am62dxx_webserver_oob_gui_offline.robot
```

The environment also needs Chromium's system libraries. See `.github/workflows/gui-offline-tests.yml` for the CI setup, which uses Node.js 22 and Python 3.12. `.github/workflows/test.yml` runs unit tests; both workflows run on pushes and pull requests.

The GUI workflow uploads the `robot-results` artifact even when tests fail. It contains Robot reports, logs, and generated output. The current workflow does not publish an HTML report website; download the artifact and open `report.html` or `log.html` locally. Offline tests do not establish EVM performance or audio quality.

Use Linux or WSL2 for the POSIX Makefile and test commands.

<a id="build-system"></a>

## Build System (Makefile)

The root `Makefile` orchestrates cross-compilation, frontend builds, and board deployment. Always pass `DEVICE=<id>`.

| Target | Behavior |
|---|---|
| `build` | Installs server dependencies and builds native helpers; additionally builds Vue only for `DEVICE=am62dxx` |
| `build-frontend` | Installs frontend dependencies and runs `VITE_DEVICE=$(DEVICE) npm run build` |
| `dev` | Starts the Node.js server with the selected device configuration; Vite is separate |
| `deploy` | Builds, then deploys binaries, server, demos and app using SSH, tar and scp; does not restart the service |
| `deploy-app` | Replaces the app directory, copies common/device app assets and device configuration/plugin; not a Vue-only copy |
| `deploy-server` | Replaces server and demos directories, installs production dependencies, writes environment configuration |
| `deploy-restart` | Restarts `webserver-oob` on the target |

Pass `DEVICE=am62dxx`, the target toolchain, and `BOARD_HOST` explicitly. Deployment targets replace their destination directories, so keep target customizations in source or outside those managed paths.

```bash
make deploy DEVICE=am62dxx CC=aarch64-linux-gnu-gcc BOARD_HOST=root@<EVM_IP>
make deploy-restart BOARD_HOST=root@<EVM_IP>
```

The root Makefile deploys configuration to `/usr/share/webserver-oob/app/device.json` and the device plugin beside it; the server is under `/usr/share/webserver-oob/server`. SDK/Yocto packaging may use different paths.

### Cross-Compilation Toolchain

``` bash
# Install the Linaro AArch64 toolchain (Ubuntu/Debian)
sudo apt-get install gcc-aarch64-linux-gnu

# Verify
aarch64-linux-gnu-gcc --version

# Build
make build DEVICE=am62dxx CC=aarch64-linux-gnu-gcc
```

### Regenerating Yocto npm.inc Files

After updating `package.json` or `package-lock.json`, regenerate the Yocto npm include files so BitBake can download the correct packages during offline builds:

``` bash
# Regenerate server-side npm.inc
node tools/generate-inc.js

# Regenerate frontend npm.inc
node tools/generate-frontend-inc.js
```

<a id="deployment"></a>

## Deployment (Manual SSH)

Before copying files to an SDK image, inspect the actual service and environment paths:

```bash
ssh root@<EVM_IP> systemctl cat webserver-oob
ssh root@<EVM_IP> cat /etc/webserver-oob.conf
```

Distinguish a root-Makefile deployment from the installed SDK layout. The device plugin is loaded beside the file selected by `DEVICE_CONFIG`; do not copy it to a guessed location. Build from the repository root with `make build-frontend DEVICE=am62dxx`; the output is `devices/am62dxx/app/vue-dist/`.

For a root-Makefile deployment, use the deploy targets in the previous section. For a frontend-only manual update to that layout:

```bash
make build-frontend DEVICE=am62dxx
scp -r devices/am62dxx/app/vue-dist root@<EVM_IP>:/usr/share/webserver-oob/app/
ssh root@<EVM_IP> systemctl restart webserver-oob
curl http://<EVM_IP>/ping
```

A successful AM62D health response is `{"ok":true}`. Check the service log with `journalctl -u webserver-oob -n 100 -f` on the target. The SDK commonly exposes the portal through a port-80 reverse proxy to the Node.js service; verify the target proxy and service configuration if port 80 is unavailable.

<a id="yocto"></a>

## Yocto Recipe (meta-tisdk)

The actual SDK recipe belongs to the selected `meta-tisdk` revision, not this repository. Inspect that recipe before assuming its source branch, `SRCREV`, `PR`, install paths, dependency list, or machine overrides. This guide does not assert that the recipe uses `AUTOREV`.

For AM62D, integration must install the server and demo plugins, device configuration and device plugin, built Vue assets, native helper binaries, and the matching inference application, pipeline JSON, model artifacts and firmware dependencies. Keep AM62D-specific frontend and inference dependencies machine-scoped so unrelated devices do not acquire them.

The root Makefile builds Vue automatically only when `DEVICE=am62dxx`. Invoke the frontend build with `VITE_DEVICE=am62dxx` when the recipe builds it directly.

After dependency changes, regenerate the npm include files used by your layer with the repository's `tools/generate-inc.js` and `tools/generate-frontend-inc.js`, and review their output and recipe references. A source update and a metadata change can require different BitBake invalidation; do not use a `PR` bump or `cleanall` as a universal substitute for checking task inputs and source revisions.

From the configured SDK build environment, a normal package rebuild is:

```bash
bitbake webserver-oob
```

Confirm the recipe name in your layer. Validate the resulting image paths against `webserver-oob.service` and `/etc/webserver-oob.conf` before deployment.

<a id="api-reference"></a>

## REST API Reference (AM62D)

Paths are relative to the portal origin. Open WebSockets using `ws://` for HTTP or `wss://` for HTTPS. Response examples below describe the upstream source baseline, not a version-independent API guarantee.

### Core Server and Device Plugin

| Method | Path | Response / request |
|---|---|---|
| GET | `/version` | `{version, buildDate, serverStarted}`; version comes from `WEBSERVER_VERSION` or the server fallback, not package.json |
| GET | `/ping` | `{ok: true}` for the Vue portal |
| GET | `/device-info` | `{id, displayName, boards, soc, activeDemos, docs}` |
| GET | `/demo-manifests` | Array of enabled demo manifests |
| POST | `/system/reboot` | `{status: "rebooting"}`; schedules reboot after 500 ms |
| POST | `/system/poweroff` | `{status: "powering-off"}`; schedules shutdown after 500 ms |
| GET | `/model-inspector-list` | `{files: [...]}` containing report filenames |
| POST | `/upload-model-file?filename=report.html` | Raw file body, limit 100 MB; `{success: true, filename}` |

The model upload is a raw-body request, not a multipart form. System metrics belong to the enabled monitoring plugin; do not infer a `/cpu-stats` JSON contract from the core server.

### Speech Enhancement

| Method | Path | Request / success response |
|---|---|---|
| GET | `/speech-enhancement/info` | `{defaultFile, defaultFileName, wavInfo}` |
| POST | `/upload-speech-enhancement-file` | Raw WAV body, maximum 50 MiB; `{path, wavInfo}`; validates 16-bit mono PCM |
| GET | `/start-speech-enhancement` | Optional `file` query parameter is a target path; defaults to configured input. Returns `{status: "started", backend, inputPath}` |
| GET | `/stop-speech-enhancement` | Returns `{status: "stopped"}`; unauthorized client IP can receive 403 |
| GET | `/speech-enhancement/status` | `{running, backend}`; backend is `edge-ai-rpmsg` or `mock` |
| GET | `/speech-enhancement/wav?channel=input` | Input WAV from active or last completed job |
| GET | `/speech-enhancement/wav?channel=output` | Output WAV when available; 404 otherwise |
| GET | `/speech-devices` | ALSA input enumeration as text, not a JSON device array |
| GET | `/speech-output-devices` | ALSA output enumeration as text |
| GET | `/tvm-daemon/status` | `{state, ready, c7xState, daemonReady, modelReady, error}` on normal status checks |

The device enumeration endpoints do not make the file-based speech start route a microphone pipeline. The current speech UI uses the default file and has no upload control; developers can use the following API sequence instead.

```bash
# Run on a host with curl and Python 3; choose the actual EVM address.
EVM_URL=http://192.168.1.100
UPLOAD_JSON=$(curl --fail --silent --show-error \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @input.wav "$EVM_URL/upload-speech-enhancement-file")
INPUT_PATH=$(printf '%s' "$UPLOAD_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["path"])')
curl --fail --get --data-urlencode "file=$INPUT_PATH" \
  "$EVM_URL/start-speech-enhancement"
# Poll status, or subscribe to /speech for detailed progress.
curl --fail "$EVM_URL/speech-enhancement/status"
# After completion:
curl --fail "$EVM_URL/speech-enhancement/wav?channel=output" -o output.wav
```

#### WebSocket `/speech`

| Message | Fields / meaning |
|---|---|
| Connection | `{status: "connected", backend}` |
| `model_loading` | `modelName`; model preparation has begun |
| `metric` | `label`; progress text |
| `spectrum` | `channel`, base64 `pcm`, `sampleRate`, `source: "rpmsg-dma"`; input/output PCM, not FFT bins |
| `chunk_timing` | `chunk`, `total`, `frameStart`, `frameEnd`, `stft`, `tvm`, `istft`, `totalMs` |
| `spectrum_done` | `inputUrl`, `outputUrl`, `totalInputSamples`, `totalOutputSamples`; successful result availability |
| `error` | `message`; processing failure |

WAV endpoints use `audio/wav`, byte-range support and `Cache-Control: no-store`. Result URLs are reused across jobs; clients must not reuse stale cached audio. A new job clears the prior completed-job reference.

### Audio Classification

| Method | Path | Request / response |
|---|---|---|
| GET | `/audio-devices` | Text entries `id|label`, including `file:<target-path>` entries on AM62D |
| GET | `/audio-output-devices` | Text output-device enumeration on AM62D |
| POST | `/upload-audio-classification-file?filename=input.wav` | Raw WAV body, maximum 50 MiB; returns `{path, name}` |
| GET | `/audio-classification/info` | `{backend, defaultFile, defaultFileName, captureSeconds, sampleRate}` |
| GET | `/audio-classification/models` | `{models: {yamnet: {label, description}, vggish: {label, description}}, default}` as configured |
| GET | `/start-audio-classification` | `model`, `source=file` or `source=device`, and `filepath`/`file` or ALSA `device`; also accepts `device=file:<path>` |
| GET | `/stop-audio-classification` | Text `Audio classification stopped`; ownership check can reject with 403 |
| GET | `/audio-classification/status` | `{running, backend, result}` |

On AM62D, a successful start returns text such as `Audio classification started (edge-ai-rpmsg, model=yamnet)`. File inference invokes the native application with the selected JSON and `--input-file`; live capture invokes it with the JSON and `--device`. The binary owns live ALSA capture. Model JSONs come from `demoConfig.audio-classification.models`.

WebSocket `/audio` can deliver `model_loading`, `status`, `patch_predictions`, `complete`, and `error` messages. Ranked patches use a `predictions` array of `{class, score}`; individual class notifications can contain `{class, timestamp, backend}` without a `type`. Do not assume all messages are a generic `result` containing `labels`.

### Custom GStreamer Pipeline

This interface is separate from the dedicated RPMsg speech/classification demos. Commands are validated and spawned directly without a shell. Shell operators, expansion, and arbitrary command chaining are not supported.

| Method | Path | Request / response |
|---|---|---|
| GET | `/gst/artifacts` | `{artifacts, dir}` |
| POST | `/gst/upload-artifact` | Raw ZIP/tar.gz/tgz body; include `filename` with the actual extension and optionally `name`. Returns `{success, name, path, fileCount, files}` |
| GET | `/gst/input-files` | `{files, dir}` |
| POST | `/gst/upload-input?filename=input.wav` | Raw file body; returns `{success, name, path, size}` |
| GET | `/gst/saved-pipelines` | `{pipelines}` |
| POST | `/gst/save-pipeline` | JSON `{id?, name, command}`; returns `{success, pipeline}` |
| DELETE | `/gst/saved-pipeline?id=<id>` | `{success: true}` |
| POST | `/gst/run` | JSON `{command}`; returns `{status: "started", pid}` |
| POST | `/gst/stop` | `{status: "stopped"}` or `{status: "not running"}`; only owning client IP can stop an active run |
| GET | `/gst/status` | Current pipeline running state |

WebSocket `/gst` sends connection, `started`, `log`, `error`, and `exit` events. Log messages carry `stream` and `text`; exit messages carry `code`. A busy pipeline/DSP can reject a run, and invalid commands are rejected before execution.

## Documentation Maintenance

Keep these guides in `devices/am62dxx/docs/`. Link the `.md` files from the repository README so GitHub renders them directly. Keep the `.html` files for browser/EVM use. This revision's HTML was generated from the Markdown with embedded styling; update the Markdown first, regenerate HTML, and check the tables, code blocks and contents links in both outputs.

The code and SDK may evolve independently. Before changing native pipeline examples or installation instructions, check the deployed RPMsg application, pipeline JSON, model artifacts and SDK recipe together.
