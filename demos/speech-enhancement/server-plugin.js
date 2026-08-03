/*
 * Copyright (C) 2024 Texas Instruments Incorporated - http://www.ti.com/
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * @file server-plugin.js
 * @memberof demos/speech-enhancement
 * @brief Express + WebSocket server plugin for the speech enhancement demo.
 *
 * Registered REST endpoints:
 * | Method | Path | Description |
 * |--------|------|-------------|
 * | GET  | /speech-devices        | List ALSA capture devices |
 * | GET  | /speech-output-devices | List ALSA playback devices |
 * | POST | /upload-speech-enhancement-file | Store raw audio binary in /tmp |
 * | GET  | /start-speech-enhancement | Start live-device or file-source pipeline |
 * | GET  | /stop-speech-enhancement  | Stop the active pipeline |
 *
 * WebSocket path: @c /speech  — broadcasts @c {label, timestamp} JSON messages.
 *
 * Data flow (device source):
 * @code
 *   speech_utils start_gst → GStreamer/NNStreamer (Silero ONNX) → FIFO
 *   → fifo-reader.js child → stdout JSON → WebSocket /speech → browser
 * @endcode
 *
 * Set @c MOCK=1 to run on x86 without GStreamer; simulated noise-reduction
 * metrics are emitted every 2 s instead.
 */

'use strict';

const { exec, execSync, spawn } = require('child_process');
const fs                        = require('fs');
const path                      = require('path');

/**
 * @brief Create an Express middleware that buffers the raw request body.
 *
 * Avoids a hard dependency on the `express` npm package (which is not
 * resolvable from the plugin path on the EVM).  Uses only Node.js
 * built-in stream events.
 *
 * @param {number} limitBytes - Maximum allowed body size; responds 413 if exceeded.
 * @returns {Function} Express-compatible middleware @c (req, res, next).
 */
function rawBody(limitBytes) {
    return (req, res, next) => {
        const chunks = [];
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > limitBytes) { res.status(413).send('Payload too large'); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on('end', () => { req.body = Buffer.concat(chunks); next(); });
        req.on('error', () => res.status(400).send('Bad request'));
    };
}

/**
 * @brief Parse @c arecord @c -l or @c aplay @c -l stdout into pipe-delimited device entries.
 *
 * Each card+device combination in the output becomes an independent
 * entry — no deduplication by card number.  Entries matching webcam,
 * camera, or cape are filtered out.
 *
 * Input line format:
 * @verbatim
 * card N: SHORT [CARD_NAME], device D: LONG_NAME SHORT_NAME [...]
 * @endverbatim
 *
 * Output format per entry: @c "plughw:N,D|CARD_NAME: DEV_SHORT"
 *
 * @param {string} stdout - Raw stdout from arecord/aplay.
 * @returns {string} Newline-separated device entries, or empty string if none.
 */
function parseAlsaOutput(stdout) {
    const results = [];
    for (const line of stdout.split('\n')) {
        if (!line.startsWith('card')) continue;
        const m = line.match(/card (\d+):.*?\[([^\]]+)\],\s*device (\d+):\s*\S+\s+(\S+)/);
        if (!m) continue;
        const [, cardNum, cardName, devNum, devShort] = m;
        if (/webcam|camera|cape/i.test(cardName)) continue;
        results.push(`plughw:${cardNum},${devNum}|${cardName}: ${devShort}`);
    }
    return results.join('\n');
}

const WS_OPEN = 1;

const MOCK        = process.env.MOCK === '1';
const fifoPath    = '/tmp/speech_enhancement_fifo';
const MODEL_PATH  = '/usr/share/oob-demo-assets/models/speech_enhancement.tflite';
const LABELS_PATH = '/usr/share/oob-demo-assets/labels/speech_enhancement_labels.txt';

const FIFO_READER = path.join(
    process.env.WEBSERVER_DIR || path.join(__dirname, '../../common/webserver'),
    'lib/fifo-reader.js'
);

const SPECTRUM_UTILS  = '/usr/bin/spectrum_utils';
const SPEC_INPUT_WAV  = '/tmp/spectrum_input.wav';
const SPEC_OUTPUT_WAV = '/tmp/spectrum_output.wav';

/**
 * @brief Write a 48 kHz mono S16LE WAV file containing a sine wave signal.
 *
 * Generates a 440 Hz fundamental with an 880 Hz second harmonic.  When
 * @p addNoise is true, white noise at 30% amplitude is added so the input
 * file sounds like a noisy recording.
 *
 * @param {string}  filePath    - Destination file path.
 * @param {number}  durationSec - Duration in seconds.
 * @param {boolean} addNoise    - Add white noise when true (noisy input).
 */
function generateSineWav(filePath, durationSec, addNoise) {
    const SR = 48000;
    const N  = SR * durationSec;
    const buf = Buffer.alloc(44 + N * 2);
    buf.write('RIFF', 0);    buf.writeUInt32LE(36 + N * 2, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);   buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1,  20);
    buf.writeUInt16LE(1,  22);
    buf.writeUInt32LE(SR, 24);
    buf.writeUInt32LE(SR * 2, 28);
    buf.writeUInt16LE(2,  32);
    buf.writeUInt16LE(16, 34);
    buf.write('data', 36);   buf.writeUInt32LE(N * 2, 40);
    for (let i = 0; i < N; i++) {
        const sine = Math.sin(2 * Math.PI * 440 * i / SR);
        const v = addNoise
            ? sine * 0.5 + (Math.random() * 2 - 1) * 0.4  /* 440 Hz sine + white noise — noisy input  */
            : sine * 0.7;                                   /* pure 440 Hz sine — clean output */
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
    }
    fs.writeFileSync(filePath, buf);
}

const MOCK_METRICS = [
    'Noise Reduction: 8.4 dB | SNR: +6.2 dB',
    'Noise Reduction: 9.1 dB | SNR: +7.0 dB',
    'Noise Reduction: 7.8 dB | SNR: +5.9 dB',
    'Noise Reduction: 10.2 dB | SNR: +8.1 dB',
    'Noise Reduction: 8.6 dB | SNR: +6.7 dB'
];

/**
 * @brief Plugin entry point called by server.js at startup.
 *
 * Registers all REST routes and the WebSocket @c /speech handler.
 * State is scoped to this closure.
 *
 * @param {object} app    - Express application instance.
 * @param {object} wss    - ws.WebSocketServer instance shared across plugins.
 * @param {object} device - Parsed device.json; use @c device.demoConfig['speech-enhancement']
 *                          for per-device tuning parameters.
 */
module.exports = function registerSpeechEnhancement(app, wss, device) {

    let fifoReaderProcess = null;
    let speechProcess     = null;
    let mockInterval      = null;
    let speechSourceMode  = 'device';
    const connectedClients = new Set();

    let specProcess     = null;
    let specBuf         = Buffer.alloc(0);
    let specMockTimer   = null;
    let specDoneTimeout = null;

    /* ------------------------------------------------------------ */
    /* REST routes                                                   */
    /* ------------------------------------------------------------ */

    app.get('/speech-devices', (req, res) => {
        if (MOCK) {
            return res.send('plughw:0,0|Mock Card: mock-input-0\nplughw:1,0|Mock Card: mock-input-1');
        }
        exec('arecord -l 2>/dev/null', (error, stdout) => {
            if (error) {
                console.error('[speech] arecord -l error:', error);
                return res.status(500).send('Error listing audio input devices');
            }
            const out = parseAlsaOutput(stdout);
            res.send(out || 'No audio input devices found');
        });
    });

    app.get('/speech-output-devices', (req, res) => {
        if (MOCK) {
            return res.send('plughw:0,0|Mock Card: mock-output-0\nplughw:0,1|Mock Card: mock-output-1');
        }
        exec('aplay -l 2>/dev/null', (error, stdout) => {
            if (error) {
                console.error('[speech] aplay -l error:', error);
                return res.status(500).send('Error listing audio output devices');
            }
            const out = parseAlsaOutput(stdout);
            res.send(out || 'No audio output devices found');
        });
    });

    /* File upload — saves raw audio binary to /tmp for later processing */
    app.post('/upload-speech-enhancement-file',
        rawBody(50 * 1024 * 1024),
        (req, res) => {
            if (MOCK) {
                return res.json({ path: '/tmp/mock_speech.wav' });
            }
            const ext = ((req.headers['x-file-ext'] || 'wav') + '').replace(/[^a-z0-9]/gi, '').slice(0, 8);
            const tmpPath = `/tmp/speech_enhancement_input.${ext}`;
            try {
                fs.writeFileSync(tmpPath, req.body);
                console.log(`[speech] Saved uploaded file: ${tmpPath} (${req.body.length} bytes)`);
                res.json({ path: tmpPath });
            } catch (e) {
                console.error('[speech] File save error:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    app.get('/start-speech-enhancement', (req, res) => {
        const source       = req.query.source   || 'device';
        const device_param = req.query.device   || 'default';
        const filepath     = req.query.filepath || '';

        if (speechProcess || mockInterval) {
            return res.status(400).send('Speech enhancement already running');
        }

        speechSourceMode = (source === 'file') ? 'file' : 'device';

        if (MOCK) {
            mockInterval = setInterval(() => {
                const label = MOCK_METRICS[Math.floor(Math.random() * MOCK_METRICS.length)];
                const msg = JSON.stringify({ label, timestamp: Date.now() });
                connectedClients.forEach(ws => {
                    if (ws.readyState === WS_OPEN) ws.send(msg);
                });
                console.log(`[speech] MOCK: ${label}`);
            }, 2000);
            return res.send('Speech enhancement started (MOCK)');
        }

        if (source === 'file') {
            if (!filepath) return res.status(400).send('filepath required for file source');
            if (!fs.existsSync(filepath)) return res.status(400).send(`File not found: ${filepath}`);

            ensureFifo();
            startFifoReader();

            const cmd = buildFilePipelineCmd(filepath);
            console.log('[speech] Starting file pipeline:', cmd);
            speechProcess = exec(cmd, (error) => {
                if (error && !error.killed) console.error('[speech] File pipeline error:', error.message);
                speechProcess = null;
                stopFifoReader();
            });
            res.send('Speech enhancement started (file)');
        } else {
            console.log('[speech] Starting enhancement with device:', device_param);
            speechProcess = spawn('/usr/bin/speech_utils', ['start_gst', device_param]);
            speechProcess.on('error', (err) => {
                console.error('[speech] Failed to start speech_utils:', err);
                speechProcess = null;
            });
            speechProcess.on('exit', (code) => {
                console.log(`[speech] speech_utils exited with code ${code}`);
                speechProcess = null;
                stopFifoReader();
            });
            startFifoReader();
            res.send('Speech enhancement started');
        }
    });

    app.get('/stop-speech-enhancement', (req, res) => {
        stopAll();
        res.send('Speech enhancement stopped');
    });

    /* ------------------------------------------------------------ */
    /* Spectrum routes                                              */
    /* ------------------------------------------------------------ */

    /**
     * @brief Generate sine WAV test files and start streaming PCM spectrum data.
     *
     * Generates a 5-second 48 kHz mono input WAV (noisy sine) and output WAV
     * (clean sine), then either spawns @c spectrum_utils (when the binary exists)
     * or runs an in-process simulation.  Each frame is broadcast over WebSocket
     * @c /speech as @c {type:'spectrum', channel:'input'|'output', pcm:base64}.
     * When streaming ends a @c {type:'spectrum_done', inputUrl, outputUrl} message
     * is broadcast so the browser can enable audio playback.
     */
    app.get('/start-spectrum', (req, res) => {
        if (specProcess || specMockTimer) return res.status(400).send('Spectrum already running');

        try {
            generateSineWav(SPEC_INPUT_WAV,  120, true);
            generateSineWav(SPEC_OUTPUT_WAV, 120, false);
        } catch (e) {
            console.error('[spectrum] WAV generation error:', e);
            return res.status(500).send('Failed to generate WAV: ' + e.message);
        }

        if (MOCK || !fs.existsSync(SPECTRUM_UTILS)) {
            startSpectrumMock(SPEC_INPUT_WAV, SPEC_OUTPUT_WAV);
            return res.send('Spectrum started (simulation)');
        }

        specProcess = spawn(SPECTRUM_UTILS, [SPEC_INPUT_WAV, SPEC_OUTPUT_WAV]);
        specProcess.stderr.on('data', d => console.error('[spectrum]', d.toString().trim()));
        specProcess.stdout.on('data', chunk => {
            specBuf = Buffer.concat([specBuf, chunk]);
            while (specBuf.length >= 1025) {
                broadcastSpectrumFrame(specBuf.slice(0, 1025));
                specBuf = specBuf.slice(1025);
            }
        });
        specProcess.on('exit', code => {
            console.log(`[spectrum] spectrum_utils exited ${code}`);
            specProcess = null;
            specBuf = Buffer.alloc(0);
            broadcastSpectrumDone();
        });
        res.send('Spectrum started');
    });

    /** @brief Stop the active spectrum streaming process or simulation. */
    app.get('/stop-spectrum', (req, res) => {
        stopSpectrum();
        res.send('Spectrum stopped');
    });

    /**
     * @brief Serve a previously generated spectrum WAV file for audio playback.
     * @query channel - @c 'input' for the noisy WAV, @c 'output' for the clean WAV.
     */
    app.get('/spectrum-wav', (req, res) => {
        const ch = (req.query.channel || '').toLowerCase();
        const filePath = ch === 'output' ? SPEC_OUTPUT_WAV : SPEC_INPUT_WAV;
        if (!fs.existsSync(filePath)) return res.status(404).send('WAV not available');
        res.setHeader('Content-Type', 'audio/wav');
        fs.createReadStream(filePath).pipe(res);
    });

    /* ------------------------------------------------------------ */
    /* Pipeline helpers                                             */
    /* ------------------------------------------------------------ */

    /** @brief Create the speech enhancement FIFO if it does not already exist. */
    function ensureFifo() {
        if (!fs.existsSync(fifoPath)) {
            try { execSync(`mkfifo "${fifoPath}"`); } catch (_) {}
        }
    }

    /**
     * @brief Assemble the gst-launch-1.0 command string for file-source enhancement.
     * @param {string} filepath - Absolute path to the audio file to process.
     * @returns {string} Shell command string ready for exec().
     */
    function buildFilePipelineCmd(filepath) {
        return [
            'gst-launch-1.0 -e',
            `filesrc location="${filepath}"`,
            '! decodebin',
            '! audioconvert',
            '! audio/x-raw,format=S16LE,channels=1,rate=16000,layout=interleaved',
            '! tensor_converter frames-per-tensor=512',
            '! queue leaky=2 max-size-buffers=10',
            `! tensor_filter framework=tensorflow2-lite model=${MODEL_PATH} custom=Delegate:XNNPACK,NumThreads:2`,
            `! tensor_decoder mode=image_labeling option1=${LABELS_PATH}`,
            `! filesink buffer-mode=2 location=${fifoPath}`
        ].join(' ');
    }

    /* ------------------------------------------------------------ */
    /* Spectrum helpers                                             */
    /* ------------------------------------------------------------ */

    /** @brief Encode one 1025-byte spectrum frame and broadcast it over WebSocket. */
    function broadcastSpectrumFrame(frame) {
        const channel = frame[0] === 0 ? 'input' : 'output';
        const pcm     = frame.slice(1).toString('base64');
        const msg     = JSON.stringify({ type: 'spectrum', channel, pcm });
        connectedClients.forEach(ws => { if (ws.readyState === WS_OPEN) ws.send(msg); });
    }

    /** @brief Broadcast a spectrum_done notification with WAV playback URLs. */
    function broadcastSpectrumDone() {
        const msg = JSON.stringify({
            type:      'spectrum_done',
            inputUrl:  '/spectrum-wav?channel=input',
            outputUrl: '/spectrum-wav?channel=output'
        });
        connectedClients.forEach(ws => { if (ws.readyState === WS_OPEN) ws.send(msg); });
    }

    /**
     * @brief Simulate spectrum_utils in Node.js — reads WAV files and streams
     *        1025-byte frames via WebSocket, paced at ~48 kHz real-time.
     *
     * @param {string} inputPath  - Path to the noisy input WAV file.
     * @param {string} outputPath - Path to the clean output WAV file.
     */
    function startSpectrumMock(inputPath, outputPath) {
        const HEADER = 44, CHUNK = 1024;
        const inData  = fs.readFileSync(inputPath);
        const outData = fs.readFileSync(outputPath);
        const durMs   = Math.floor((inData.length - HEADER) / 2 / 48000 * 1000);
        let inPos = HEADER, outPos = HEADER;

        specMockTimer = setInterval(() => {
            if (inPos + CHUNK > inData.length) inPos = HEADER;
            const inFrame = Buffer.alloc(1 + CHUNK);
            inData.copy(inFrame, 1, inPos, inPos + CHUNK);
            inFrame[0] = 0x00;
            broadcastSpectrumFrame(inFrame);
            inPos += CHUNK;

            if (outPos + CHUNK > outData.length) outPos = HEADER;
            const outFrame = Buffer.alloc(1 + CHUNK);
            outData.copy(outFrame, 1, outPos, outPos + CHUNK);
            outFrame[0] = 0x01;
            broadcastSpectrumFrame(outFrame);
            outPos += CHUNK;
        }, 11);

        specDoneTimeout = setTimeout(() => {
            stopSpectrum();
            broadcastSpectrumDone();
        }, durMs);

        console.log('[spectrum] mock stream started, duration', durMs, 'ms');
    }

    /** @brief Stop all spectrum streaming: mock timer, real process, and buffered data. */
    function stopSpectrum() {
        if (specMockTimer)   { clearInterval(specMockTimer);   specMockTimer   = null; }
        if (specDoneTimeout) { clearTimeout(specDoneTimeout);  specDoneTimeout = null; }
        if (specProcess)     { specProcess.kill('SIGTERM');    specProcess     = null; }
        specBuf = Buffer.alloc(0);
    }

    /* ------------------------------------------------------------ */
    /* FIFO reader child process                                     */
    /* ------------------------------------------------------------ */

    /**
     * @brief Spawn the fifo-reader.js child process to consume enhancement output.
     *
     * The child reads lines from the FIFO and emits JSON objects on stdout.
     * Each @c {type:"classification"} message is broadcast as @c {label, timestamp}
     * to all connected WebSocket clients on @c /speech.  No-op if already running.
     */
    function startFifoReader() {
        if (fifoReaderProcess) return;

        console.log('[speech] Starting FIFO reader');
        fifoReaderProcess = spawn('node', [FIFO_READER]);

        fifoReaderProcess.stdout.on('data', (data) => {
            data.toString().split('\n').forEach(line => {
                if (!line.trim()) return;
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'classification') {
                        const out = JSON.stringify({ label: msg.class, timestamp: msg.timestamp });
                        connectedClients.forEach(ws => {
                            if (ws.readyState === WS_OPEN) ws.send(out);
                        });
                    } else if (msg.type === 'error') {
                        console.error(`[speech] FIFO error: ${msg.message}`);
                    }
                } catch (e) {
                    console.error('[speech] FIFO parse error:', e);
                }
            });
        });

        fifoReaderProcess.stderr.on('data', (data) => console.error(`[speech] FIFO stderr: ${data}`));
        fifoReaderProcess.on('exit', (code) => {
            console.log(`[speech] FIFO reader exited ${code}`);
            fifoReaderProcess = null;
        });
    }

    /** @brief Terminate the fifo-reader child process if running. */
    function stopFifoReader() {
        if (fifoReaderProcess) {
            fifoReaderProcess.kill('SIGTERM');
            fifoReaderProcess = null;
        }
    }

    /**
     * @brief Stop all active pipelines and timers, clean up processes.
     *
     * Handles both MOCK interval and real speech_utils / GStreamer processes.
     * Called on REST @c /stop-speech-enhancement and on SIGTERM/SIGINT.
     */
    function stopAll() {
        if (mockInterval) { clearInterval(mockInterval); mockInterval = null; }
        if (speechProcess) {
            if (speechSourceMode === 'device') {
                exec('/usr/bin/speech_utils stop_gst', (err) => {
                    if (err) console.error('[speech] Error stopping speech_utils:', err);
                });
            }
            speechProcess.kill();
            speechProcess = null;
        }
        stopFifoReader();
        stopSpectrum();
        exec('pkill -f gst-launch', () => {});
    }

    /* ------------------------------------------------------------ */
    /* WebSocket /speech                                            */
    /* ------------------------------------------------------------ */

    wss.on('connection', (ws, req) => {
        if (req.url !== '/speech') return;

        connectedClients.add(ws);
        ws.send(JSON.stringify({ status: 'connected', message: 'WebSocket connected for speech enhancement' }));

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'diagnostic_ping') {
                    ws.send(JSON.stringify({
                        type:           'diagnostic_response',
                        fifo_exists:    fs.existsSync(fifoPath),
                        reader_running: fifoReaderProcess !== null,
                        mock_mode:      MOCK,
                        timestamp:      Date.now()
                    }));
                }
            } catch (e) { console.error('[speech] WS message error:', e); }
        });

        ws.on('close', () => connectedClients.delete(ws));
        ws.on('error', (err) => { console.error('[speech] WS error:', err); connectedClients.delete(ws); });
    });

    process.on('SIGTERM', stopAll);
    process.on('SIGINT',  stopAll);

    console.log('[speech-enhancement] Plugin registered' + (MOCK ? ' (MOCK mode)' : ''));
};
