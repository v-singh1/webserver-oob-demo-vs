/*
 * Copyright (C) 2024 Texas Instruments Incorporated - http://www.ti.com/
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * audio-classification demo server plugin
 * Registers:
 *   GET  /audio-devices
 *   POST /upload-audio-classification-file   (raw binary, ?ext=wav)
 *   GET  /start-audio-classification?device=<alsa-device>
 *   GET  /start-audio-classification?source=file&filepath=<path>
 *   GET  /stop-audio-classification
 *   WebSocket path: /audio
 *
 * Uses fifo-reader.js child process for blocking FIFO reads.
 * Supports MOCK=1 env var for development on x86 without GStreamer.
 */

'use strict';

const { exec, execSync, spawn } = require('child_process');
const express                   = require('express');
const fs                        = require('fs');
const path                      = require('path');

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
            return res.send('plughw:0,0|Mock USB Microphone\nplughw:1,0|Mock Built-in Mic');
        }
        exec('/usr/bin/audio_utils devices', (error, stdout) => {
            if (error) {
                console.error('[audio] audio_utils devices error:', error);
                return res.status(500).send('Error listing audio devices');
            }
            res.send(stdout);
        });
    });

    /* File upload — saves raw audio binary to /tmp for later classification */
    app.post('/upload-audio-classification-file',
        express.raw({ type: '*/*', limit: '50mb' }),
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

    function stopFifoReader() {
        if (fifoReaderProcess) {
            fifoReaderProcess.kill('SIGTERM');
            fifoReaderProcess = null;
        }
    }

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
