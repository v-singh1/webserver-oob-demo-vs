/*
 * Copyright (C) 2024 Texas Instruments Incorporated - http://www.ti.com/
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * cpu-monitor demo server plugin
 * Registers: GET /run-uname, GET /cpu-load, GET /cpu-info
 * Supports MOCK=1 env var for development on x86 without target binaries.
 */

'use strict';

const { exec } = require('child_process');
const fs = require('fs');

const MOCK = process.env.MOCK === '1';

/* Read /proc/stat and return {idle, total} */
function readProcStat() {
    try {
        const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
        const vals = line.replace(/^cpu\s+/, '').split(/\s+/).map(Number);
        const idle  = vals[3] + vals[4];
        const total = vals.reduce((a, b) => a + b, 0);
        return { idle, total };
    } catch (e) { return null; }
}

/* Calculate CPU % by sampling /proc/stat twice, 200ms apart */
function getCpuPercent(cb) {
    const s1 = readProcStat();
    if (!s1) return cb(null);
    setTimeout(() => {
        const s2 = readProcStat();
        if (!s2) return cb(null);
        const totalDiff = s2.total - s1.total;
        const idleDiff  = s2.idle  - s1.idle;
        if (totalDiff <= 0) return cb(null);
        cb(parseFloat(((totalDiff - idleDiff) / totalDiff * 100).toFixed(1)));
    }, 200);
}

module.exports = function registerCpuMonitor(app, wss, device) {

    /* System info */
    app.get('/run-uname', (req, res) => {
        if (MOCK) {
            return res.send('Linux mock-device 6.1.0-mock #1 SMP PREEMPT Thu Jan 1 00:00:00 UTC 2024 armv7l armv7l GNU/Linux');
        }
        exec('uname -a', (error, stdout) => {
            if (error) {
                console.error('[cpu-monitor] uname error:', error);
                return res.status(500).send(error.message);
            }
            res.send(stdout);
        });
    });

    /* CPU load — tries cpu_stats enhanced binary, falls back to /proc/stat */
    app.get('/cpu-load', (req, res) => {
        if (MOCK) {
            const load = (20 + Math.random() * 60).toFixed(1);
            return res.json({
                cpu_percent:     parseFloat(load),
                current_cpu_usage: parseFloat(load),
                average_cpu_usage: parseFloat((parseFloat(load) * 0.9).toFixed(1)),
                max_cpu_usage:   parseFloat((parseFloat(load) * 1.1).toFixed(1)),
                history: Array.from({length: 10}, () => parseFloat((Math.random() * 80).toFixed(1)))
            });
        }
        exec('/usr/bin/cpu_stats enhanced', (error, stdout) => {
            if (!error && stdout.trim()) {
                return res.send(stdout);
            }
            /* Binary unavailable — fall back to /proc/stat */
            getCpuPercent(pct => {
                if (pct === null) return res.status(503).json({ error: 'cpu_stats unavailable' });
                res.json({ current_cpu_usage: pct, average_cpu_usage: pct, max_cpu_usage: pct, history: [] });
            });
        });
    });

    /* CPU info — returns JSON produced by cpu_stats info */
    app.get('/cpu-info', (req, res) => {
        if (MOCK) {
            return res.send(JSON.stringify({
                model:   device.soc || 'Mock SoC',
                cores:   1,
                threads: 1,
                mhz:     1000
            }));
        }
        exec('/usr/bin/cpu_stats info', (error, stdout) => {
            if (error) {
                console.error('[cpu-monitor] cpu_stats info error:', error);
                return res.status(500).send(error.message);
            }
            res.send(stdout);
        });
    });

    /* System logs — recent journal entries for the webserver service */
    app.get('/logs', (req, res) => {
        const n = Math.min(parseInt(req.query.n) || 80, 200);
        exec(`journalctl -u webserver-oob -n ${n} --no-pager --output=short 2>/dev/null || journalctl -n ${n} --no-pager --output=short 2>/dev/null`, (err, stdout) => {
            const raw = (err || !stdout.trim()) ? '' : stdout;
            const lines = raw.split('\n').filter(l => l.trim()).reverse();
            res.json({ lines, count: lines.length });
        });
    });

    /* System uptime — reads /proc/uptime */
    app.get('/sys-uptime', (req, res) => {
        if (MOCK) {
            return res.json({ uptime_seconds: 3600 * 26 + 1800 });
        }
        try {
            const secs = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
            res.json({ uptime_seconds: Math.floor(secs) });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /* Memory info — reads /proc/meminfo */
    app.get('/mem-info', (req, res) => {
        if (MOCK) {
            return res.json({ total_kb: 2097152, available_kb: 1572864 });
        }
        exec('cat /proc/meminfo', (error, stdout) => {
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            const totalMatch     = stdout.match(/MemTotal:\s+(\d+)/);
            const availableMatch = stdout.match(/MemAvailable:\s+(\d+)/);
            res.json({
                total_kb:     totalMatch     ? parseInt(totalMatch[1])     : 0,
                available_kb: availableMatch ? parseInt(availableMatch[1]) : 0
            });
        });
    });

    console.log('[cpu-monitor] Plugin registered' + (MOCK ? ' (MOCK mode)' : ''));
};
