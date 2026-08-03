/*
 * Copyright (C) 2024 Texas Instruments Incorporated - http://www.ti.com/
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * @file server-plugin.js
 * @memberof demos/audio-classification
 * @brief Express + WebSocket server plugin for the YAMNet audio classification demo.
 *
 * Registered REST endpoints:
 * | Method | Path | Description |
 * |--------|------|-------------|
 * | GET  | /audio-devices | List ALSA capture devices |
 * | GET  | /audio-output-devices | List ALSA playback devices |
 * | POST | /upload-audio-classification-file | Store raw audio binary in /tmp |
 * | GET  | /start-audio-classification | Start live-device or file-source pipeline |
 * | GET  | /stop-audio-classification  | Stop the active pipeline |
 *
 * WebSocket path: @c /audio  — broadcasts @c {class, timestamp} JSON messages.
 *
 * Data flow (device source):
 * @code
 *   audio_utils start_gst → GStreamer/NNStreamer → FIFO
 *   → fifo-reader.js child → stdout JSON → WebSocket /audio → browser
 * @endcode
 *
 * Set @c MOCK=1 to run on x86 without GStreamer; random YAMNet labels are
 * emitted every 2 s instead.
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

const WS_OPEN = 1; /* WebSocket.OPEN — spec constant, no ws import needed */

const MOCK       = process.env.MOCK === '1';
const fifoPath   = '/tmp/audio_classification_fifo';
const MODEL_PATH  = '/usr/share/oob-demo-assets/models/yamnet_audio_classification.tflite';
const LABELS_PATH = '/usr/share/oob-demo-assets/labels/yamnet_label_list.txt';

/* Resolve via WEBSERVER_DIR (set by server.js) so the path is correct on target
 * (/usr/lib/node_modules/webserver-oob/lib/) and in dev (repo common/webserver/lib/). */
const FIFO_READER = path.join(
    process.env.WEBSERVER_DIR || path.join(__dirname, '../../common/webserver'),
    'lib/fifo-reader.js'
);

/* Fake audio classes for MOCK mode */
const MOCK_CLASSES = [
    'Speech', 'Music', 'Silence', 'Vehicle', 'Keyboard typing',
    'Clapping', 'Cough', 'Dog bark', 'Water', 'Wind'
];

/**
 * @brief Plugin entry point called by server.js at startup.
 *
 * Registers all REST routes and the WebSocket @c /audio handler.
 * State is scoped to this closure so multiple require() calls would
 * produce independent plugin instances (not currently used).
 *
 * @param {object} app    - Express application instance.
 * @param {object} wss    - ws.WebSocketServer instance shared across plugins.
 * @param {object} device - Parsed device.json; use @c device.demoConfig['audio-classification']
 *                          for per-device tuning parameters.
 */
module.exports = function registerAudioClassification(app, wss, device) {

    let fifoReaderProcess = null;
    let audioProcess      = null;
    let mockInterval      = null;
    let audioSourceMode   = 'device'; /* 'device' | 'file' */
    const connectedClients = new Set();

    /* ------------------------------------------------------------ */
    /* REST routes                                                   */
    /* ------------------------------------------------------------ */

    app.get('/audio-devices', (req, res) => {
        if (MOCK) {
            return res.send('plughw:0,0|Mock Card: mock-input-0\nplughw:1,0|Mock Card: mock-input-1');
        }
        exec('arecord -l 2>/dev/null', (error, stdout) => {
            if (error) {
                console.error('[audio] arecord -l error:', error);
                return res.status(500).send('Error listing audio input devices');
            }
            const out = parseAlsaOutput(stdout);
            res.send(out || 'No audio input devices found');
        });
    });

    app.get('/audio-output-devices', (req, res) => {
        if (MOCK) {
            return res.send('plughw:0,0|Mock Card: mock-output-0\nplughw:0,1|Mock Card: mock-output-1');
        }
        exec('aplay -l 2>/dev/null', (error, stdout) => {
            if (error) {
                console.error('[audio] aplay -l error:', error);
                return res.status(500).send('Error listing audio output devices');
            }
            const out = parseAlsaOutput(stdout);
            res.send(out || 'No audio output devices found');
        });
    });

    /* File upload — saves raw audio binary to /tmp for later classification */
    app.post('/upload-audio-classification-file',
        rawBody(50 * 1024 * 1024),
        (req, res) => {
            if (MOCK) {
                return res.json({ path: '/tmp/mock_audio.wav' });
            }
            const ext = ((req.headers['x-file-ext'] || 'wav') + '').replace(/[^a-z0-9]/gi, '').slice(0, 8);
            const tmpPath = `/tmp/audio_classification_input.${ext}`;
            try {
                fs.writeFileSync(tmpPath, req.body);
                console.log(`[audio] Saved uploaded file: ${tmpPath} (${req.body.length} bytes)`);
                res.json({ path: tmpPath });
            } catch (e) {
                console.error('[audio] File save error:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    app.get('/start-audio-classification', (req, res) => {
        const source       = req.query.source   || 'device';
        const device_param = req.query.device   || 'default';
        const filepath     = req.query.filepath || '';

        if (audioProcess || mockInterval) {
            return res.status(400).send('Audio classification already running');
        }

        audioSourceMode = (source === 'file') ? 'file' : 'device';

        if (MOCK) {
            mockInterval = setInterval(() => {
                const cls = MOCK_CLASSES[Math.floor(Math.random() * MOCK_CLASSES.length)];
                const msg = JSON.stringify({ class: cls, timestamp: Date.now() });
                connectedClients.forEach(ws => {
                    if (ws.readyState === WS_OPEN) ws.send(msg);
                });
                console.log(`[audio] MOCK classification: ${cls}`);
            }, 2000);
            return res.send('Audio classification started (MOCK)');
        }

        if (source === 'file') {
            if (!filepath) return res.status(400).send('filepath required for file source');
            if (!fs.existsSync(filepath)) return res.status(400).send(`File not found: ${filepath}`);

            ensureFifo();
            startFifoReader();

            const cmd = buildFilePipelineCmd(filepath);
            console.log('[audio] Starting file pipeline:', cmd);
            audioProcess = exec(cmd, (error) => {
                if (error && !error.killed) console.error('[audio] File pipeline error:', error.message);
                audioProcess = null;
                stopFifoReader();
            });
            res.send('Audio classification started (file)');
        } else {
            console.log('[audio] Starting classification with device:', device_param);
            audioProcess = spawn('/usr/bin/audio_utils', ['start_gst', device_param]);
            audioProcess.on('error', (err) => {
                console.error('[audio] Failed to start audio_utils:', err);
                audioProcess = null;
            });
            audioProcess.on('exit', (code) => {
                console.log(`[audio] audio_utils exited with code ${code}`);
                audioProcess = null;
                stopFifoReader();
            });
            startFifoReader();
            res.send('Audio classification started');
        }
    });

    app.get('/stop-audio-classification', (req, res) => {
        stopAll();
        res.send('Audio classification stopped');
    });

    /* ------------------------------------------------------------ */
    /* Pipeline helpers                                             */
    /* ------------------------------------------------------------ */

    /** @brief Create the classification FIFO if it does not already exist. */
    function ensureFifo() {
        if (!fs.existsSync(fifoPath)) {
            try { execSync(`mkfifo "${fifoPath}"`); } catch (_) {}
        }
    }

    /**
     * @brief Assemble the gst-launch-1.0 command string for file-source classification.
     * @param {string} filepath - Absolute path to the audio file to classify.
     * @returns {string} Shell command string ready for exec().
     */
    function buildFilePipelineCmd(filepath) {
        return [
            'gst-launch-1.0 -e',
            `filesrc location="${filepath}"`,
            '! decodebin',
            '! audioconvert',
            '! audio/x-raw,format=S16LE,channels=1,rate=16000,layout=interleaved',
            '! tensor_converter frames-per-tensor=3900',
            '! tensor_aggregator frames-in=3900 frames-out=15600 frames-flush=3900 frames-dim=1',
            '! tensor_transform mode=arithmetic option=typecast:float32,add:0.5,div:32767.5',
            '! tensor_transform mode=transpose option=1:0:2:3',
            '! queue leaky=2 max-size-buffers=10',
            `! tensor_filter framework=tensorflow2-lite model=${MODEL_PATH} custom=Delegate:XNNPACK,NumThreads:2`,
            `! tensor_decoder mode=image_labeling option1=${LABELS_PATH}`,
            `! filesink buffer-mode=2 location=${fifoPath}`
        ].join(' ');
    }

    /* ------------------------------------------------------------ */
    /* FIFO reader child process                                     */
    /* ------------------------------------------------------------ */

    /**
     * @brief Spawn the fifo-reader.js child process to consume classification labels.
     *
     * The child reads lines from the FIFO (blocking) and emits JSON objects on
     * stdout.  Each @c {type:"classification"} message is broadcast to all
     * connected WebSocket clients on @c /audio.  No-op if already running.
     */
    function startFifoReader() {
        if (fifoReaderProcess) return;

        console.log('[audio] Starting FIFO reader child process');
        fifoReaderProcess = spawn('node', [FIFO_READER]);

        fifoReaderProcess.stdout.on('data', (data) => {
            data.toString().split('\n').forEach(line => {
                if (!line.trim()) return;
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'classification') {
                        const out = JSON.stringify({ class: msg.class, timestamp: msg.timestamp });
                        connectedClients.forEach(ws => {
                            if (ws.readyState === WS_OPEN) ws.send(out);
                        });
                        console.log(`[audio] Classification: ${msg.class}`);
                    } else if (msg.type === 'status') {
                        console.log(`[audio] FIFO status: ${msg.message}`);
                    } else if (msg.type === 'error') {
                        console.error(`[audio] FIFO error: ${msg.message}`);
                    }
                } catch (e) {
                    console.error('[audio] Failed to parse FIFO message:', e);
                }
            });
        });

        fifoReaderProcess.stderr.on('data', (data) => {
            console.error(`[audio] FIFO reader stderr: ${data}`);
        });

        fifoReaderProcess.on('exit', (code) => {
            console.log(`[audio] FIFO reader exited with code ${code}`);
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
     * Handles both MOCK interval and real audio_utils / GStreamer processes.
     * Called on REST @c /stop-audio-classification and on SIGTERM/SIGINT.
     */
    function stopAll() {
        if (mockInterval) {
            clearInterval(mockInterval);
            mockInterval = null;
        }
        if (audioProcess) {
            if (audioSourceMode === 'device') {
                exec('/usr/bin/audio_utils stop_gst', (err) => {
                    if (err) console.error('[audio] Error stopping audio_utils:', err);
                });
            }
            audioProcess.kill();
            audioProcess = null;
        }
        stopFifoReader();
        exec('pkill -f gst-launch', () => {});
    }

    /* ------------------------------------------------------------ */
    /* WebSocket /audio                                             */
    /* ------------------------------------------------------------ */

    wss.on('connection', (ws, req) => {
        if (req.url !== '/audio') return;

        console.log('[audio] WebSocket client connected');
        connectedClients.add(ws);

        ws.send(JSON.stringify({
            status:  'connected',
            message: 'WebSocket connected for audio classification'
        }));

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'diagnostic_ping') {
                    ws.send(JSON.stringify({
                        type:          'diagnostic_response',
                        fifo_exists:   fs.existsSync(fifoPath),
                        reader_running: fifoReaderProcess !== null,
                        mock_mode:     MOCK,
                        timestamp:     Date.now()
                    }));
                }
            } catch (e) {
                console.error('[audio] WebSocket message parse error:', e);
            }
        });

        ws.on('close', () => {
            console.log('[audio] WebSocket client disconnected');
            connectedClients.delete(ws);
        });

        ws.on('error', (err) => {
            console.error('[audio] WebSocket error:', err);
            connectedClients.delete(ws);
        });
    });

    /* Clean up on server exit */
    process.on('SIGTERM', stopAll);
    process.on('SIGINT',  stopAll);

    console.log('[audio-classification] Plugin registered' + (MOCK ? ' (MOCK mode)' : ''));
};
