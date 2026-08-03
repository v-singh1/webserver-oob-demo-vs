# Edge-AI speech enhancement web demo

The web plugin runs the `edge-ai` RPMsg-DMA client from the companion
`rpmsg-dma-pb` project and sends its interactive commands through standard
input. The client publishes each exact C7x DMA input/output block on
`/tmp/edge-ai-speech.sock`; the webserver relays that stream through `/speech`
for the live spectrum and waveform. The completed WAV files are served only
for browser playback.

## Target installation

Build and install `example/edge-ai/rpmsg_inference_example` from the
`next` branch of `paresh-bhagat/rpmsg-dma-pb`, then install it at
`/usr/bin/rpmsg_inference_example`.  Copy `audio_pipeline_clean.json` from
this directory to:

```
/usr/share/webserver-oob/demos/speech-enhancement/audio_pipeline_clean.json
```

Set `demoConfig.speech-enhancement.artifactsPath` in the AM62D device config
to the deployed Neo-TVM artifact directory. The plugin fails explicitly if the
binary, pipeline JSON, or artifacts are absent; it never substitutes a
synthetic DSP result on hardware.

Install the supplied `input.wav` at `/usr/share/input.wav`. It is a mono,
16-bit PCM 16 kHz noisy sine input. The RPMsg application reads this target-side
file directly; the browser does not upload input audio.

## Current upstream limitation

The referenced `edge-ai` example is an integration sample: its checked-in
`PipelineManager` processes one 512-sample chunk, and its TVM invocation is
commented out. Apply the companion `rpmsg-dma-pb` patch before building the
client; it changes the client to process each STFT block and trims the final
zero-padded block. The TVM invocation still needs to be enabled with the
correct model artifacts. This is intentionally documented so an STFT/ISTFT-only
output is not mistaken for complete noise suppression.
