■ Texas Instruments

# AM62D User Guide

**Source baseline:** upstream `main`, commit [`60d434b`](https://github.com/TexasInstruments/webserver-oob-demo/commit/60d434b4dbb3b45d53862864da7f38b0a5867acb) (21 September 2026).

Companion guide: [AM62D Developer Guide](am62d-developer-guide.md).

This guide describes the repository implementation at that revision. Target firmware, model artifacts, SDK packaging, and measured performance depend on the installed SDK. The documentation update was checked against source; it is not an EVM validation report.

End-User Guide — Portal Navigation, Demo Operation & Feature Reference

**Platform** AM62Dx quad Cortex-A53 + C7x DSP

## Contents

- [1 Introduction](#intro)
- [2 Getting Started](#getting-started)
- [3 Portal Layout & Navigation](#layout)
- [4 Home Page](#home)
- [5 Speech Enhancement](#speech-enhancement)
- [6 Audio Classification](#audio-classification)
- [7 Audio DSP Offload](#audio-offload)
- [8 2D FFT Offload](#2dfft)
- [9 Sigchain Biquad EQ](#biquad)
- [10 Custom Audio Pipeline (GStreamer)](#gst-pipeline)
- [11 AI Model Inspector](#model-inspector)
- [12 Power Controls](#power)
- [13 System Panel](#system)
- [14 Troubleshooting](#troubleshooting)

<a id="intro"></a>

## 1 Introduction

The **TI SITARA AM62D DSP + Edge AI Experience Portal** is a browser-based demo portal that runs directly on the AM62D EVM. It provides file-based speech enhancement, live or file-based audio classification, and DSP offload demos using C7x and the installed TVM/TIDL runtime.

🎙

#### Audio Intelligence

File-based speech enhancement and environmental audio classification powered by C7x DSP + TVM.

⚡

#### DSP Acceleration

C7x DSP offload demos: 8-channel audio, 2D FFT, and parametric biquad EQ via RPMsg-DMA.

🔧

#### Custom Pipeline

Run and experiment with custom GStreamer pipelines using TVM artifact management.

🔍

#### AI Model Inspector

Upload and view AI model inspection reports for AM62D deployments.

### AM62D Platform

| Component             | Details                                                              |
|-----------------------|----------------------------------------------------------------------|
| Application Processor | Quad Arm® Cortex®-A53 @ 1.4 GHz                                      |
| DSP                   | C7x DSP with MMA — high-performance signal processing & AI inference |
| AI Inference          | TVM / TIDL — compiled neural network models running natively on C7x  |
| Audio                 | ALSA-based capture/playback; PCM6240 ADC / TAD5212 DAC support       |
| OS                    | Linux (Yocto-based TI SDK 12.02)                                     |

<a id="getting-started"></a>

## 2 Getting Started

### Hardware Requirements

- **AM62D EVM** — powered and booted
- **Ethernet cable** — EVM connected to your local network
- **Microphone** — for live audio classification; select the ALSA device detected on your EVM rather than assuming a fixed card number
- **Audio files** — 16-bit PCM mono WAV at 16 kHz for the supplied speech and classification models
- **Web browser** — Chrome, Firefox, or Edge (latest)

### Finding the EVM IP Address

Connect a USB-to-UART cable and open the serial console at **115200 baud**. After boot, run:

    ip addr show eth0

Alternatively, check your DHCP router's client list. The EVM hostname is typically `am62dxx-evm`.

### Opening the Portal

1.  **Open a browser on your PC** (on the same network as the EVM)
2.  **Navigate to `http://<EVM_IP>`** — the portal is served on port 80 by default
3.  **The home page loads automatically** — no login required

**Auto-start**

The portal starts automatically at boot via the `webserver-oob.service` systemd unit. No manual startup needed.

**TVM Initialization**

Audio Intelligence polls C7x/TVM readiness and displays initialization errors. The initial readiness check times out after 90 seconds. Model loading can also occur when starting a demo or switching models; follow the status banner rather than assuming a fixed initialization time.

<a id="layout"></a>

## 3 Portal Layout & Navigation

### Sidebar Navigation

| Section    | Items              | Description                                               |
|------------|--------------------|-----------------------------------------------------------|
| **Home**   | Home               | Overview, demo cards, SDK info                            |
| **Demos**  | Audio Intelligence | Speech Enhancement, Audio Classification, Custom Pipeline |
|            | DSP Acceleration   | Audio Offload, 2D FFT, Sigchain Biquad EQ                 |
| **Tools**  | AI Model Inspector | Upload and view model inspection reports                  |
| **System** | Device Info        | Board, SoC, active demos, SDK versions                    |
|            | Logs               | Live server-side log stream                               |
|            | Help               | Documentation links                                       |

### App Bar (Top Right)

| Control         | Description                                                                                       |
|-----------------|---------------------------------------------------------------------------------------------------|
| ⟳ Reboot        | Reboots the EVM. Shows a confirmation dialog first. Portal reconnects automatically after reboot. |
| ⏻ Power Off     | Shuts down the EVM. Shows a confirmation dialog first.                                            |
| ☀ / 🌙 Theme    | Toggles between dark and light mode. Canvas visualizations update immediately.                    |
| Connected label | Shows "AM62D EVM" when the portal is connected to the backend.                                    |

**Power Controls**

The Reboot and Power Off buttons are always visible in the top-right corner regardless of which page you are on. A confirmation dialog is shown before any action is executed.

<a id="home"></a>

## 4 Home Page

The home page provides a portal overview and quick navigation to all demos.

- **Hero section** — Platform description and "Get Started" button linking to Audio Intelligence
- **Demo cards** — Click any card to navigate directly to that demo
- **SDK version cards** — Shows declared reference versions: SDK 12.02.00.03, MCU+ SDK 12.02.00.01, and TIDL 11.02.16.00. These labels are configured in the frontend, not detected from the installed packages
- **About section** — Brief description of the portal and platform

<a id="speech-enhancement"></a>

## 5 Speech Enhancement

Audio Intelligence → Speech Enhancement

### What It Does

Processes a WAV file using the installed `rpmsg_inference_example` application and speech pipeline JSON. The intended model is GCRN (Gated Convolutional Recurrent Network), running with TVM/TIDL on C7x. The dedicated speech demo uses the RPMsg application; the Custom Audio Pipeline tab is the separate GStreamer interface.

The configured processing stages are input PCM, STFT, deinterleave, TVM inference, interleave, ISTFT, and output PCM. Confirm the deployed JSON and model artifacts match the intended enhancement pipeline.

### Input Requirements

| Parameter | Requirement |
|---|---|
| File format | WAV containing 16-bit PCM, mono |
| Model sample rate | 16 kHz for the supplied speech model |
| Default target file | `/usr/share/tvm_inference/input/input_audio.wav` |
| Source configuration | `demoConfig.speech-enhancement.inputPath` in the device configuration |

The current speech panel displays the default audio file and its metadata. It does **not** expose a live microphone selector or a file-upload button. An upload API is available to developers; see the [Developer Guide](am62d-developer-guide.md#api-reference). The API's mono/16-bit validation does not replace checking the model's sample-rate requirement.

### How to Use

1. Open Audio Intelligence → Speech Enhancement.
2. Check the Audio Source card. Ensure the default WAV exists on the EVM and matches the model input format.
3. Click **Run** in the page header. Follow the loading and processing status.
4. Compare input/output spectrograms and waveforms while data arrives.
5. Review per-chunk STFT, GCRN/TVM, ISTFT, and total timing. These are processing measurements, not a guarantee of real-time microphone performance.
6. Allow the file job to complete. Use **Stop** only to cancel a running job; cancellation does not guarantee completed results.
7. Play the completed input and output WAVs using their audio players. Click a playback track to seek.
8. Click **Save ZIP** to export available results.

### Visualization and Export

| Control or result | Purpose |
|---|---|
| Per-plot peak | Scales each spectrogram relative to its own peak; useful for detail, but not a common level reference |
| Shared reference | Uses a common FFT reference to compare input and output levels |
| Quiet detail | Extends the displayed range from −80…0 dB to −110…0 dB |
| Spectrogram zoom | Changes the amount of history displayed |
| Waveform zoom and cursor | Inspects amplitudes and corresponding times |
| Save ZIP | Includes available `spectrogram.png`, `waveform.png`, `timings.csv`, `input.wav`, and `output.wav` |

Playback progress follows the audio element's playback time. The completed position is retained at the end; pause, source changes, and leaving the component stop progress updates. WAV serving supports byte ranges and disables caching for reused result URLs.

**Interpreting results:** use shared-reference scaling and listen to both WAVs when comparing levels. Independent peak normalization can make a quiet output appear visually stronger than expected. Verify that the deployed pipeline includes working inference before interpreting STFT/ISTFT output as noise suppression.

<a id="audio-classification"></a>

## 6 Audio Classification

Audio Intelligence → Audio Classification

The AM62D backend uses `rpmsg_inference_example` with the JSON selected by the model configuration. Other devices can use a different backend.

| Model | Configured classes | Pipeline JSON |
|---|---|---|
| YAMNet | 521 AudioSet classes | `pipeline_audio_classification_yamnet.json` |
| VGGish | 10 UrbanSound8K classes | `pipeline_audio_classification_vggish.json` |

### How to Use

1. Select the model in the Model selector.
2. Select an available microphone or WAV file in Audio Source. Source selection is separate from model selection; use a source supported by the deployed model JSON.
3. To use a local recording, use the upload control and select a compatible WAV. The default configured file is `/usr/share/tvm_inference/input/input_audio.wav`.
4. Click **Run**. Inspect classification labels, scores, and available prediction visualizations; the YAMNet UI also provides a patch heatmap.
5. A file run completes after processing the selected input. For live microphone operation, click **Stop** when finished.

For AM62D live capture, the native RPMsg application owns the ALSA device and processes successive windows. The server does not launch a separate `arecord` capture process for this path. Update frequency depends on the model and target performance; no fixed interval is guaranteed.

Use 16 kHz mono PCM for the supplied model configuration. If a device is missing, run `arecord -l` on the EVM and check the selected card/device.

<a id="audio-offload"></a>

## 7 Audio DSP Offload

DSP Acceleration → Audio DSP Offload

### What It Does

Demonstrates 8-channel audio processing offloaded to the C7x DSP via RPMsg-DMA. The DSP applies FFT bandpass filtering in real time. Includes live input/output spectrum visualization and CPU vs DSP load comparison.

### Live Visualizations

| Chart                 | Color                | Description                                           |
|-----------------------|----------------------|-------------------------------------------------------|
| Input Audio Spectrum  | Green                | Frequency spectrum of raw audio before DSP processing |
| Output Audio Spectrum | Blue                 | Frequency spectrum after bandpass filtering by C7x    |
| Average Amplitude     | Cyan                 | RMS amplitude trend over time                         |
| Frame Latency         | Green                | End-to-end processing latency per frame (ms)          |
| System Load           | Blue CPU / Amber DSP | CPU and C7x DSP utilization over time                 |

### How to Use

1.  **Navigate to DSP Acceleration → Audio DSP Offload tab**
2.  **Toggle the Filter button** to enable or disable the bandpass filter.  
    Filter ON shows the effect on the output spectrum. Filter OFF passes audio through unmodified.
3.  **Click Run**  
    The `rpmsg_audio_offload_example` binary starts on the EVM. All five live charts begin updating.
4.  **Observe the metrics** — Frame count, latency (min/avg/max), CPU load, and DSP load are shown in the Live Metrics panel.
5.  **Click Stop** to end the demo.

**Overlay Conflict**

This demo requires the DSP audio overlay (`k3-am62d2-evm-dsp-controlled-audio.dtbo`) to be *inactive*. If it is active, the portal shows a conflict banner with a "Remove Overlay & Reboot" button.

<a id="2dfft"></a>

## 8 2D FFT Offload

DSP Acceleration → 2D FFT Offload

### What It Does

Computes a 128×128 2D Fast Fourier Transform on the C7x DSP via RPMsg-DMA. Demonstrates raw DSP compute throughput and compares ARM vs C7x execution paths.

### How to Use

1.  **Navigate to DSP Acceleration → 2D FFT Offload tab**
2.  **Click Run** — the FFT benchmark starts on the C7x DSP.
3.  **Observe live metrics** — throughput (MB/s), execution time (ms), and iteration count update in real time.
4.  **Click Stop** when done.

<a id="biquad"></a>

## 9 Sigchain Biquad EQ

DSP Acceleration → Sigchain Biquad EQ

### What It Does

Runs a 3-stage cascade biquad equalizer on the C7x DSP. Audio is captured via PCM6240 ADC and played back through TAD5212 DAC with real-time EQ applied by the DSP. Live trend charts show DSP load, processing cycles, and throughput.

### How to Use

1.  **Navigate to DSP Acceleration → Sigchain Biquad EQ tab**
2.  **Click Run** — the biquad sigchain application starts and the portal begins receiving its metrics.
3.  **Watch the trend charts** — DSP load (%), processing cycles, and throughput (MB/s) update continuously.
4.  **Click Stop** to end the demo.

<a id="gst-pipeline"></a>

## 10 Custom Audio Pipeline (GStreamer)

Audio Intelligence → Custom Audio Pipeline

### What It Does

Lets you build, run, and save any `gst-launch-1.0` pipeline on the EVM with real-time log output. Includes preset pipelines for common use cases and full management of TVM artifacts and input audio files.

### Pipeline Presets

| Preset                | Input                           | Pipeline                                                     | Output                            |
|-----------------------|---------------------------------|--------------------------------------------------------------|-----------------------------------|
| Speech Enhancement    | WAV file (`input_audio.wav`)    | tidspkernel STFT → deinterleave → titvm → interleave → ISTFT | `/tmp/gst_enhanced.wav` + speaker |
| YAMNet Classification | Live mic (`alsasrc hw:1,0`)     | tidspkernel STFT → titvm (top-3)                             | fakesink (results in log)         |
| VGGish Classification | WAV file (`urbansound_16k.wav`) | tidspkernel STFT → titvm (top-3)                             | `vggish_inference_output.bin`     |

### Running a Preset

1.  **Click a preset chip** (Speech Enhancement, Classification YAMNet, or Classification VGGish).  
    The command textarea fills automatically.
2.  **Review the command** in the textarea — paths are pre-filled with EVM defaults.
3.  **Click Run** (in the page header).  
    Pipeline output appears in the log panel below in real time.
4.  **Click Stop** to kill the pipeline.

### Running a Custom Pipeline

1.  **Click the "Custom" preset chip**.  
    The textarea shows a blank `gst-launch-1.0` prompt.
2.  **Type or paste your pipeline command.**  
    Use the supported `gst-launch-1.0` command syntax. The backend validates the command and launches it without a shell; shell expansion, redirection, and command chaining are not supported.
3.  **Optionally insert paths** using the TVM Artifacts or Input Files panels (see below).
4.  **Click Run.**

**Use button availability**

The **Use** button in TVM Artifacts and Input Files panels is only enabled when **Custom** preset or a **Saved Pipeline** is selected. It is disabled for named presets to prevent accidental path injection.

### Managing TVM Artifacts

TVM artifacts are compiled model directories stored at `/usr/share/tvm_inference/artifacts/` on the EVM.

1.  **Open the TVM Artifacts panel** — click to expand.
2.  **Click Refresh** to list available artifact directories.
3.  **Click Use** on an artifact to insert its path at the cursor position in the command textarea (Custom mode only).
4.  **Upload a new artifact** — click "Upload Archive", select a `.zip` or `.tar.gz` file. The archive is extracted to the artifacts directory.

### Managing Input Files

Input files are stored at `/usr/share/tvm_inference/input/` on the EVM.

1.  **Open the Input Files panel** — click to expand.
2.  **Click Refresh** to list available files.
3.  **Click Use** to insert the file path into the command (Custom mode only).
4.  **Upload a file** — click "Upload File", select a WAV/MP3/FLAC file from your PC.

### Saving & Loading Pipelines

1.  **Click "Save As"** in the Pipeline Command card header.
2.  **Enter a name** and click Save. The pipeline is stored persistently on the EVM.
3.  **Saved pipelines** appear as bookmark chips below the preset chips. Click any chip to reload that pipeline.
4.  **To update a saved pipeline** — select it, edit the command, then click "Save".
5.  **To delete** — click the × on the bookmark chip.

<a id="model-inspector"></a>

## 11 AI Model Inspector

Tools → AI Model Inspector

### What It Does

Allows you to upload and view AI model inspection reports generated for AM62D deployments. Reports are HTML files that show model architecture, layer details, and performance metrics.

### How to Use

1.  **Navigate to Tools → AI Model Inspector.**
2.  **Click "Upload Report"** and select an HTML model inspection report from your PC.
3.  **The report appears in the list** — click its name to view it in the embedded viewer.
4.  **Browse the report** — includes model architecture, layer names, tensor shapes, and AM62D inference performance metrics.

<a id="power"></a>

## 12 Power Controls

Power controls are located in the **top-right corner of the app bar**, always visible on every page.

| Button        | Icon                   | Action                   | What happens                                                                                                            |
|---------------|------------------------|--------------------------|-------------------------------------------------------------------------------------------------------------------------|
| Reboot EVM    | ⟳ (amber restart icon) | Reboots the AM62D EVM    | Confirmation dialog → EVM reboots after ~500ms → portal shows "Rebooting…" → auto-reconnects when EVM comes back online |
| Power Off EVM | ⏻ (red power icon)     | Shuts down the AM62D EVM | Confirmation dialog → EVM powers off after ~500ms → portal shows "Powering off…"                                        |

**Note**

After Power Off, the EVM must be physically powered back on. There is no remote power-on mechanism in the portal.

<a id="system"></a>

## 13 System Panel

### Device Info

System → Device Info

Shows configured device information and active demos. SDK version labels are declared frontend reference values, not a runtime package inventory.

- **Board** — Board name and description (e.g., SK-AM62D)
- **SoC** — AM62Dx quad Cortex-A53 @ 1.4GHz + C7x DSP
- **Active Demos** — List of demos loaded by the portal
- **SDK Versions** — SDK, MCU+ SDK, TIDL version numbers

### Logs

System → Logs

Streams live server-side logs from the Node.js backend. Useful for debugging demo issues or monitoring pipeline activity.

### Help

System → Help

Links to documentation including this user guide, demo guide, and developer guide.

<a id="troubleshooting"></a>

## 14 Troubleshooting

| Issue                                   | Likely Cause                                      | Fix                                                                                                        |
|-----------------------------------------|---------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| Portal not loading in browser           | EVM not reachable or service not running          | Check EVM IP. On EVM console: `systemctl status webserver-oob`. Restart: `systemctl restart webserver-oob` |
| "TVM Loading" banner stuck              | TVM daemon initializing C7x DSP                   | Inspect the readiness error after the 90-second timeout; check C7x remoteproc, `tvm-model-daemon`, model artifacts, and service logs                      |
| No audio devices listed                 | Microphone not connected or ALSA not detecting it | Connect USB microphone. On EVM: `arecord -l` to verify ALSA sees the device                                |
| Speech Enhancement API: WAV upload error    | File not 16-bit mono WAV                          | Convert with: `ffmpeg -i input.wav -ar 16000 -ac 1 -c:a pcm_s16le output.wav`                             |
| Audio DSP Offload: conflict banner      | DSP audio overlay is active                       | Click "Remove Overlay & Reboot" in the banner. Wait for reboot.                                            |
| Spectrograms appear black in light mode | Cached old bundle                                 | Hard refresh: **Ctrl+Shift+R** (Chrome/Firefox) or **Cmd+Shift+R** (Mac)                                   |
| GStreamer pipeline error in log         | Missing element or wrong pipeline syntax          | Check log for element name errors. Verify artifact path exists at `/usr/share/tvm_inference/artifacts/`    |
| Power button shows "Failed"             | Server-side error or permission issue             | Check logs. On EVM: `systemctl status webserver-oob`                                                       |
| Page does not update after reboot       | Browser not auto-reconnecting                     | Manually refresh the page after EVM comes back online (~30–60 seconds after reboot)                        |

### Service Management (on EVM)

    systemctl status webserver-oob      # check service status
    systemctl restart webserver-oob     # restart server
    journalctl -u webserver-oob -f      # follow live logs
    journalctl -u webserver-oob -n 100  # last 100 log lines

TI SITARA AM62D DSP + Edge AI Experience Portal — User Guide — SDK 12.02.00.03  \|  © 2026 Texas Instruments Incorporated

### Shared DSP and Missing Results

Only one coordinated DSP demo can own C7x at a time. Stop the active demo before starting another. A stop request from a different client IP can be rejected; return to the client that started the run.

If speech output is missing, inspect the server log for a missing binary, JSON, artifacts, or `processed_output.wav`. If waveform or spectrogram updates are absent, check the native application's visualization socket and browser connection. Mock-mode results are synthetic and cannot validate target inference quality or timing.
