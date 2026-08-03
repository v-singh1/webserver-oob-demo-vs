/*
 * Edge-AI speech enhancement plugin for AM62D.
 *
 * This is deliberately wired to the RPMsg-DMA edge-ai client, rather than to
 * the older GStreamer demonstration.  The client receives commands on stdin:
 *   pipeline <json>, tvm_artifacts <dir>, input <wav>, run, quit
 * It writes processed_output.wav in its working directory.
 */
'use strict';

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const MOCK = process.env.MOCK === '1';
const WS_OPEN = 1;
const JOB_ROOT = '/tmp/webserver-oob-speech';


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

function parseAlsaOutput(stdout) {
    return stdout.split('\n').flatMap(line => {
        const match = line.match(/card (\d+):.*?\[([^\]]+)\],\s*device (\d+):\s*\S+\s+(\S+)/);
        if (!match || /webcam|camera|cape/i.test(match[2])) return [];
        return [`plughw:${match[1]},${match[3]}|${match[2]}: ${match[4]}`];
    }).join('\n');
}

/* Parse WAV chunks and return fmt + data buffers (throws on invalid files). */
function _parseWavChunks(wav) {
    if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
        throw new Error('Not a valid WAV file');
    let offset = 12, fmt, data;
    while (offset + 8 <= wav.length) {
        const id = wav.toString('ascii', offset, offset + 4);
        const len = wav.readUInt32LE(offset + 4);
        if (id === 'fmt ') fmt = wav.subarray(offset + 8, offset + 8 + len);
        if (id === 'data') { data = wav.subarray(offset + 8, offset + 8 + len); break; }
        offset += 8 + len + (len & 1);
    }
    if (!fmt) throw new Error('Invalid WAV: missing fmt chunk');
    return { fmt, data };
}

/* Validate and return PCM payload; requires 16-bit mono 48 kHz. */
function readPcmWav(filename) {
    const wav = fs.readFileSync(filename);
    const { fmt, data } = _parseWavChunks(wav);
    if (!data) throw new Error('Invalid WAV: missing data chunk');
    const audioFmt = fmt.readUInt16LE(0);
    const channels = fmt.readUInt16LE(2);
    const sampleRate = fmt.readUInt32LE(4);
    const bitsPerSample = fmt.readUInt16LE(14);
    if (audioFmt !== 1)       throw new Error('WAV must be uncompressed PCM (got compressed format)');
    if (channels !== 1)       throw new Error(`WAV must be mono (got ${channels} channels)`);
    if (bitsPerSample !== 16) throw new Error(`WAV must be 16-bit (got ${bitsPerSample}-bit)`);
    return { pcm: data, sampleRate };
}

/* Read WAV info without throwing; returns null on failure. */
function readPcmWavInfo(filename) {
    try {
        const wav = fs.readFileSync(filename);
        const { fmt, data } = _parseWavChunks(wav);
        const channels = fmt.readUInt16LE(2);
        const sampleRate = fmt.readUInt32LE(4);
        const bitsPerSample = fmt.readUInt16LE(14);
        const dataBytes = data ? data.length : 0;
        const durationSec = sampleRate > 0 ? parseFloat((dataBytes / (sampleRate * channels * (bitsPerSample / 8))).toFixed(2)) : 0;
        return { channels, sampleRate, bitsPerSample, durationSec };
    } catch (_) { return null; }
}

module.exports = function registerSpeechEnhancement(app, wss, device) {
    const config = (device.demoConfig || {})['speech-enhancement'] || {};
    const binary = config.edgeAiBinary || '/usr/bin/rpmsg_inference_example /usr/bin/rpmsg_inference_example';
    const tvmDir = config.tvmDir || '/usr/share/tvm_inference';
    const inputPath = config.inputPath || '/usr/share/tvm_inference/input/input_audio.wav';
    const jsonFile = config.jsonFile || 'pipeline_stft_istft.json';
    const outputName = config.outputName || 'processed_output.wav';
    const streamSocket = config.streamSocket || '/tmp/edge-ai-speech.sock';
    const clients = new Set();
    let job = null;
    let lastCompletedJob = null;
    let streamTimers = [];
    let dmaSocket = null;
    let dmaBuffer = Buffer.alloc(0);

    function send(message) {
        const encoded = JSON.stringify(message);
        clients.forEach(ws => { if (ws.readyState === WS_OPEN) ws.send(encoded); });
    }

    function stopStreams() {
        streamTimers.forEach(clearTimeout);
        streamTimers = [];
    }

    // The RPMsg client owns this Unix socket and sends EASP binary frames at
    // the exact DMA boundaries: 13-byte header + signed-16-bit PCM payload.
    function connectDmaStream() {
        const retry = () => {
            if (!job || MOCK || dmaSocket) return;
            const socket = net.createConnection(streamSocket);
            socket.on('connect', () => { dmaSocket = socket; send({ type: 'metric', label: 'Connected to RPMsg DMA audio stream' }); });
            socket.on('data', chunk => {
                dmaBuffer = Buffer.concat([dmaBuffer, chunk]);
                while (dmaBuffer.length >= 13) {
                    if (dmaBuffer.toString('ascii', 0, 4) !== 'EASP') { dmaBuffer = Buffer.alloc(0); return; }
                    const direction = dmaBuffer[4], sampleRate = dmaBuffer.readUInt32LE(5), bytes = dmaBuffer.readUInt32LE(9);
                    if (dmaBuffer.length < 13 + bytes) return;
                    const pcm = dmaBuffer.subarray(13, 13 + bytes); dmaBuffer = dmaBuffer.subarray(13 + bytes);
                    if (job) job.dmaFrames = true;
                    send({ type: 'spectrum', channel: direction ? 'output' : 'input', pcm: pcm.toString('base64'), sampleRate, source: 'rpmsg-dma' });
                }
            });
            socket.on('error', () => { if (!dmaSocket && job) setTimeout(retry, 50); });
            socket.on('close', () => { if (dmaSocket === socket) dmaSocket = null; });
        };
        retry();
    }

    function streamWav(channel, filename, done) {
        let source;
        try { source = readPcmWav(filename); }
        catch (error) { send({ type: 'error', message: error.message }); return done && done(error); }

        const frameBytes = 1024; // 512 samples: exactly one Edge-AI STFT input block.
        let offset = 0;
        const periodMs = Math.max(1, Math.round(frameBytes / 2 / source.sampleRate * 1000));
        const emit = () => {
            if (!job || job.cancelled) return;
            if (offset >= source.pcm.length) return done && done();
            const pcm = source.pcm.subarray(offset, Math.min(offset + frameBytes, source.pcm.length));
            offset += pcm.length;
            send({ type: 'spectrum', channel, pcm: pcm.toString('base64'), sampleRate: source.sampleRate });
            const timer = setTimeout(emit, periodMs);
            streamTimers.push(timer);
        };
        emit();
    }

    function finishJob(error) {
        if (!job) return;
        const finished = job;
        if (error) {
            send({ type: 'error', message: error.message || String(error) });
            job = null;
            return;
        }
        if (!fs.existsSync(finished.outputPath)) {
            send({ type: 'error', message: 'Edge-AI client completed without processed_output.wav' });
            job = null;
            return;
        }
        if (finished.dmaFrames) {
            send({ type: 'spectrum_done', inputUrl: '/speech-enhancement/wav?channel=input', outputUrl: '/speech-enhancement/wav?channel=output' });
            lastCompletedJob = finished;
            job = null;
            return;
        }
        send({ type: 'metric', label: 'C7x processing complete — streaming enhanced output' });
        streamWav('output', finished.outputPath, () => {
            if (job !== finished) return;
            send({ type: 'spectrum_done', inputUrl: '/speech-enhancement/wav?channel=input', outputUrl: '/speech-enhancement/wav?channel=output' });
            lastCompletedJob = finished;
            job = null;
        });
    }

    function startEdgeAi(inputPath) {
        console.log('[speech-enhancement] startEdgeAi called with inputPath:', inputPath);
        if (job) throw new Error('Speech enhancement is already running');
        lastCompletedJob = null;
        fs.mkdirSync(JOB_ROOT, { recursive: true });
        const jobDir = fs.mkdtempSync(path.join(JOB_ROOT, 'job-'));
        const outputPath = path.join(jobDir, outputName);
        console.log('[speech-enhancement] jobDir:', jobDir, 'outputPath:', outputPath);

        console.log('[speech-enhancement] validating WAV file');
        readPcmWav(inputPath); // Validate WAV before switching C7x firmware.
        job = { inputPath, outputPath, process: null, cancelled: false, stdout: '', dmaFrames: false };
        send({ type: 'metric', label: 'Waiting for RPMsg DMA input/output buffers' });
        console.log('[speech-enhancement] checking binary:', binary);
        if (!fs.existsSync(binary)) throw new Error(`Edge-AI client not installed: ${binary}`);
        const baseJsonPath = path.join(tvmDir, jsonFile);
        console.log('[speech-enhancement] checking pipeline config:', baseJsonPath);
        if (!fs.existsSync(baseJsonPath)) throw new Error(`Edge-AI pipeline config not installed: ${baseJsonPath}`);

        // Write a per-job JSON with the correct input_file path so the binary
        // processes the right audio without modifying the installed template.
        const baseJson = JSON.parse(fs.readFileSync(baseJsonPath, 'utf8'));
        const jobJson = Object.assign({}, baseJson, { input_file: inputPath });
        const jobJsonPath = path.join(jobDir, 'pipeline.json');
        fs.writeFileSync(jobJsonPath, JSON.stringify(jobJson));
        console.log('[speech-enhancement] wrote per-job JSON:', jobJsonPath);

        console.log('[speech-enhancement] spawning binary with args:', [jobJsonPath]);
        const child = spawn(binary, [jobJsonPath], { cwd: jobDir, stdio: ['pipe', 'pipe', 'pipe'] });
        job.process = child;
        console.log('[speech-enhancement] child process spawned, pid:', child.pid);
        connectDmaStream();
        let lastBatch = { num: 0, total: 0, windows: 0, sampleStart: 0, sampleEnd: 0, bytes: 0 };
        const collect = data => {
            const text = data.toString();
            if (job) job.stdout += text;
            console.log('[speech-enhancement] child stdout:', text.trim());
            text.split('\n').filter(Boolean).forEach(line => {
                const batchMatch = line.match(/Processing batch\s+(\d+)\/(\d+)\s+\((\d+)\s+windows,\s+samples\s+(\d+)-(\d+),\s+(\d+)\s+bytes\)/i);
                if (batchMatch) {
                    lastBatch = {
                        num:         parseInt(batchMatch[1]),
                        total:       parseInt(batchMatch[2]),
                        windows:     parseInt(batchMatch[3]),
                        sampleStart: parseInt(batchMatch[4]),
                        sampleEnd:   parseInt(batchMatch[5]),
                        bytes:       parseInt(batchMatch[6]),
                    };
                }
                const rmsMatch = line.match(/Overall error RMS.*?:\s*([\d.]+)/i);
                if (rmsMatch) {
                    send({ type: 'rms', ...lastBatch, value: parseFloat(rmsMatch[1]) });
                }
                if (/Pipeline completed successfully/i.test(line)) { send({ type: 'metric', label: 'Pipeline completed successfully' }); }
            });
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', (data) => {
            const text = data.toString();
            console.log('[speech-enhancement] child stderr:', text.trim());
        });
        child.on('error', (error) => {
            console.log('[speech-enhancement] child error:', error);
            finishJob(error);
        });
        child.on('close', (code) => {
            console.log('[speech-enhancement] child closed with code:', code);
            if (!job || job.process !== child) return;
            if (job.cancelled) return;
            finishJob(code === 0 ? null : new Error(`Edge-AI client exited with ${code}`));
        });
    }

    function stopJob() {
        stopStreams();
        if (job) {
            job.cancelled = true;
            if (job.process) job.process.kill('SIGTERM');
            job = null;
        }
        if (dmaSocket) { dmaSocket.destroy(); dmaSocket = null; }
        dmaBuffer = Buffer.alloc(0);
    }

    app.get('/speech-devices', (req, res) => exec('arecord -l 2>/dev/null', (error, stdout) =>
        res.send(error ? 'No audio input devices found' : (parseAlsaOutput(stdout) || 'No audio input devices found'))));
    app.get('/speech-output-devices', (req, res) => exec('aplay -l 2>/dev/null', (error, stdout) =>
        res.send(error ? 'No audio output devices found' : (parseAlsaOutput(stdout) || 'No audio output devices found'))));

    app.get('/speech-enhancement/info', (req, res) => {
        const wavInfo = readPcmWavInfo(inputPath);
        res.json({ defaultFile: inputPath, defaultFileName: path.basename(inputPath), wavInfo });
    });

    app.post('/upload-speech-enhancement-file', rawBody(50 * 1024 * 1024), (req, res) => {
        try {
            fs.mkdirSync(JOB_ROOT, { recursive: true });
            const uploadPath = path.join(JOB_ROOT, 'upload.wav');
            fs.writeFileSync(uploadPath, req.body);
            readPcmWav(uploadPath);  // validates 16-bit mono 48 kHz
            const wavInfo = readPcmWavInfo(uploadPath);
            res.json({ path: uploadPath, wavInfo });
        } catch (error) { res.status(400).json({ error: error.message }); }
    });

    app.get('/start-speech-enhancement', (req, res) => {
        const fileToUse = req.query.file || inputPath;
        try { startEdgeAi(fileToUse); res.json({ status: 'started', backend: MOCK ? 'mock' : 'edge-ai-rpmsg', inputPath: fileToUse }); }
        catch (error) { stopJob(); res.status(400).json({ error: error.message }); }
    });
    app.get('/stop-speech-enhancement', (req, res) => { stopJob(); res.json({ status: 'stopped' }); });
    app.get('/speech-enhancement/status', (req, res) => res.json({ running: Boolean(job), backend: MOCK ? 'mock' : 'edge-ai-rpmsg' }));

    app.get('/speech-enhancement/wav', (req, res) => {
        const active = job || lastCompletedJob;
        const channel = req.query.channel === 'output' ? 'output' : 'input';
        const filename = active && (channel === 'output' ? active.outputPath : active.inputPath);
        if (!filename || !fs.existsSync(filename)) return res.status(404).send('Audio is not available');
        res.type('audio/wav');
        fs.createReadStream(filename).pipe(res);
    });

    wss.on('connection', (ws, req) => {
        if (req.url !== '/speech') return;
        clients.add(ws);
        ws.send(JSON.stringify({ status: 'connected', backend: MOCK ? 'mock' : 'edge-ai-rpmsg' }));
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
    });
    process.on('SIGTERM', stopJob);
    process.on('SIGINT', stopJob);
    console.log(`[speech-enhancement] Edge-AI RPMsg plugin registered${MOCK ? ' (MOCK)' : ''}`);
};
