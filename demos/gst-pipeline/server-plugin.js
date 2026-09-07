'use strict';

/*
 * GStreamer pipeline demo — server plugin for AM62D.
 *
 * HTTP endpoints:
 *   GET  /gst/artifacts                        list TVM artifact directories
 *   POST /gst/upload-artifact?name=<dir>       upload zip or tar.gz archive
 *   GET  /gst/input-files                      list files in the input directory
 *   POST /gst/upload-input?filename=<name>     upload an input audio file
 *   POST /gst/run          { command: "..." }  start gst-launch-1.0 pipeline
 *   POST /gst/stop                             kill running pipeline
 *   GET  /gst/status                           { running, pid }
 *
 * WebSocket  /gst
 *   server → client:
 *     { type:'connected', running }
 *     { type:'started',   command, pid }
 *     { type:'log',       stream:'stdout'|'stderr', text }
 *     { type:'error',     message }
 *     { type:'exit',      code, reason? }
 */

const { spawn, execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const WS_OPEN        = 1;
const MAX_UPLOAD_MB  = 200;

module.exports = function registerGstPipeline(app, wss, device) {
    const config       = (device.demoConfig || {})['gst-pipeline'] || {};
    const artifactsDir = config.artifactsDir || '/usr/share/tvm_inference/artifacts';
    const inputDir     = config.inputDir     || '/usr/share/tvm_inference/input';

    const clients  = new Set();
    let activeProc = null;

    /* ── helpers ────────────────────────────────────────────────── */

    function broadcast(msg) {
        const data = JSON.stringify(msg);
        clients.forEach(ws => { if (ws.readyState === WS_OPEN) ws.send(data); });
    }

    function readRawBody(req, res, maxBytes, cb) {
        const chunks = [];
        let total = 0;
        req.on('data', chunk => {
            total += chunk.length;
            if (total > maxBytes) { res.status(413).send('Payload too large'); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on('end',   () => cb(Buffer.concat(chunks)));
        req.on('error', () => res.status(400).send('Bad request'));
    }

    function killActive() {
        if (!activeProc) return;
        try { activeProc.kill('SIGINT');  } catch (_) {}
        try { activeProc.kill('SIGTERM'); } catch (_) {}
        activeProc = null;
    }

    /* ── GET /gst/artifacts ─────────────────────────────────────── */

    app.get('/gst/artifacts', (req, res) => {
        try {
            if (!fs.existsSync(artifactsDir))
                return res.json({ artifacts: [], dir: artifactsDir });

            const entries = fs.readdirSync(artifactsDir, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => {
                    let files = [];
                    try { files = fs.readdirSync(path.join(artifactsDir, e.name)); } catch (_) {}
                    return { name: e.name, path: path.join(artifactsDir, e.name), fileCount: files.length, files };
                })
                .sort((a, b) => a.name.localeCompare(b.name));

            res.json({ artifacts: entries, dir: artifactsDir });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /* ── POST /gst/upload-artifact?name=<dir> ───────────────────── */

    app.post('/gst/upload-artifact', (req, res) => {
        readRawBody(req, res, MAX_UPLOAD_MB * 1024 * 1024, body => {
            /* sanitise artifact directory name */
            const rawName = ((req.query.name || req.query.filename || '') + '')
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9._-]/g, '')
                .replace(/\.(zip|tar\.gz|tgz)$/i, '')
                .slice(0, 64) || 'artifact';

            const destDir = path.join(artifactsDir, rawName);
            const isTar   = /\.tar\.gz$/i.test(req.query.filename || '') ||
                            /\.tgz$/i.test(req.query.filename || '');
            const ext     = isTar ? '.tar.gz' : '.zip';
            const tmpFile = path.join('/tmp', `gst-artifact-${Date.now()}${ext}`);

            try {
                fs.mkdirSync(destDir, { recursive: true });
                fs.writeFileSync(tmpFile, body);

                if (isTar) {
                    execSync(`tar -xzf "${tmpFile}" -C "${destDir}" 2>&1`, { timeout: 60000 });
                } else {
                    execSync(`unzip -o "${tmpFile}" -d "${destDir}" 2>&1`, { timeout: 60000 });
                }

                const files = fs.readdirSync(destDir);
                res.json({ success: true, name: rawName, path: destDir, fileCount: files.length, files });
            } catch (e) {
                res.status(400).json({ error: e.message });
            } finally {
                try { fs.unlinkSync(tmpFile); } catch (_) {}
            }
        });
    });

    /* ── GET /gst/input-files ──────────────────────────────────── */

    app.get('/gst/input-files', (req, res) => {
        try {
            if (!fs.existsSync(inputDir))
                return res.json({ files: [], dir: inputDir });

            const entries = fs.readdirSync(inputDir, { withFileTypes: true })
                .filter(e => e.isFile())
                .map(e => {
                    let size = 0;
                    try { size = fs.statSync(path.join(inputDir, e.name)).size; } catch (_) {}
                    return { name: e.name, path: path.join(inputDir, e.name), size };
                })
                .sort((a, b) => a.name.localeCompare(b.name));

            res.json({ files: entries, dir: inputDir });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /* ── POST /gst/upload-input?filename=<name> ─────────────────── */

    app.post('/gst/upload-input', (req, res) => {
        readRawBody(req, res, 50 * 1024 * 1024, body => {
            const rawName = ((req.query.filename || '') + '')
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9._-]/g, '')
                .slice(0, 128) || 'input.wav';
            const dest = path.join(inputDir, rawName);
            try {
                fs.mkdirSync(inputDir, { recursive: true });
                fs.writeFileSync(dest, body);
                const size = fs.statSync(dest).size;
                res.json({ success: true, name: rawName, path: dest, size });
            } catch (e) {
                res.status(400).json({ error: e.message });
            }
        });
    });

    /* ── POST /gst/run  { command } ─────────────────────────────── */

    app.post('/gst/run', (req, res) => {
        if (activeProc) return res.status(409).json({ error: 'A pipeline is already running' });

        const command = ((req.body || {}).command || '').trim();
        if (!command)              return res.status(400).json({ error: 'No command provided' });
        if (!/^gst-launch/i.test(command))
            return res.status(400).json({ error: 'Only gst-launch commands are permitted' });

        try {
            const proc = spawn('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
            activeProc = proc;
            broadcast({ type: 'started', command, pid: proc.pid });

            const relay = stream => chunk => broadcast({ type: 'log', stream, text: chunk.toString() });
            proc.stdout.on('data', relay('stdout'));
            proc.stderr.on('data', relay('stderr'));

            proc.on('error', err => {
                if (activeProc === proc) activeProc = null;
                broadcast({ type: 'error', message: err.message });
            });
            proc.on('close', code => {
                if (activeProc === proc) activeProc = null;
                broadcast({ type: 'exit', code });
            });

            res.json({ status: 'started', pid: proc.pid });
        } catch (e) {
            activeProc = null;
            res.status(500).json({ error: e.message });
        }
    });

    /* ── POST /gst/stop ─────────────────────────────────────────── */

    app.post('/gst/stop', (req, res) => {
        if (!activeProc) return res.json({ status: 'not running' });
        killActive();
        broadcast({ type: 'exit', code: null, reason: 'user stopped' });
        res.json({ status: 'stopped' });
    });

    /* ── GET /gst/status ────────────────────────────────────────── */

    app.get('/gst/status', (req, res) =>
        res.json({ running: Boolean(activeProc), pid: activeProc?.pid || null }));

    /* ── WebSocket /gst ─────────────────────────────────────────── */

    wss.on('connection', (ws, req) => {
        if (req.url !== '/gst') return;
        clients.add(ws);
        ws.send(JSON.stringify({ type: 'connected', running: Boolean(activeProc) }));
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
    });

    process.on('SIGTERM', killActive);
    process.on('SIGINT',  killActive);

    console.log('[gst-pipeline] GStreamer pipeline plugin registered');
};
