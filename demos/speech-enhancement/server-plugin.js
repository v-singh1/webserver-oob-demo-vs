/*
 * Copyright (C) 2024 Texas Instruments Incorporated - http://www.ti.com/
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * speech-enhancement demo server plugin
 * Registers:
 *   GET  /speech-devices
 *   POST /upload-speech-enhancement-file   (raw binary, ?ext=wav)
 *   GET  /start-speech-enhancement?device=<alsa-device>
 *   GET  /start-speech-enhancement?source=file&filepath=<path>
 *   GET  /stop-speech-enhancement
 *   WebSocket path: /speech
 *
 * Supports MOCK=1 env var for development on x86 without target binaries.
 */

'use strict';

const { exec, execSync, spawn } = require('child_process');
const express                   = require('express');
const fs                        = require('fs');
const path                      = require('path');

const WS_OPEN = 1;

const MOCK        = process.env.MOCK === '1';
const fifoPath    = '/tmp/speech_enhancement_fifo';
const MODEL_PATH  = '/usr/share/oob-demo-assets/models/speech_enhancement.tflite';
const LABELS_PATH = '/usr/share/oob-demo-assets/labels/speech_enhancement_labels.txt';

const FIFO_READER = path.join(
    process.env.WEBSERVER_DIR || path.join(__dirname, '../../common/webserver'),
    'lib/fifo-reader.js'
);

const MOCK_METRICS = [
    'Noise Reduction: 8.4 dB | SNR: +6.2 dB',
    'Noise Reduction: 9.1 dB | SNR: +7.0 dB',
    'Noise Reduction: 7.8 dB | SNR: +5.9 dB',
    'Noise Reduction: 10.2 dB | SNR: +8.1 dB',
    'Noise Reduction: 8.6 dB | SNR: +6.7 dB'
];

module.exports = function registerSpeechEnhancement(app, wss, device) {

    let fifoReaderProcess = null;
    let speechProcess     = null;
    let mockInterval      = null;
    let speechSourceMode  = 'device';
    const connectedClients = new Set();

    /* ------------------------------------------------------------ */
    /* REST routes                                                   */
    /* ------------------------------------------------------------ */

    app.get('/speech-devices', (req, res) => {
        if (MOCK) {
            return res.send('plughw:0,0|Mock USB Microphone\nplughw:1,0|Mock Built-in Mic');
        }
        exec('/usr/bin/audio_utils devices', (error, stdout) => {
            if (error) {
                console.error('[speech] audio_utils devices error:', error);
                return res.status(500).send('Error listing audio devices');
            }
            res.send(stdout);
        });
    });

    /* File upload — saves raw audio binary to /tmp for later processing */
    app.post('/upload-speech-enhancement-file',
        express.raw({ type: '*/*', limit: '50mb' }),
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
    /* Pipeline helpers                                             */
    /* ------------------------------------------------------------ */

    function ensureFifo() {
        if (!fs.existsSync(fifoPath)) {
            try { execSync(`mkfifo "${fifoPath}"`); } catch (_) {}
        }
    }

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
    /* FIFO reader child process                                     */
    /* ------------------------------------------------------------ */

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

    function stopFifoReader() {
        if (fifoReaderProcess) {
            fifoReaderProcess.kill('SIGTERM');
            fifoReaderProcess = null;
        }
    }

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
