/*
 * Copyright (C) 2026 Texas Instruments Incorporated - http://www.ti.com/
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * TVM inference demo server plugin
 * Registers: GET /tvm-inference/run, GET /tvm-inference/status, GET /tvm-inference/stop
 * Invokes: rpmsg_inference_example /usr/share/tvm_inference/json_files/pipeline_tvm_inference.json
 */

'use strict';

const { spawn } = require('child_process');

const MOCK = process.env.MOCK === '1';

let inferenceProcess = null;
let inferenceResults = null;
let isRunning = false;

module.exports = function registerTvmInference(app, wss, device) {
    const config = (device.demoConfig || {})['tvm-inference'] || {};
    const binary  = config.edgeAiBinary || '/usr/bin/rpmsg_inference_example';
    const jsonFile = config.jsonFile    || '/usr/share/tvm_inference/json_files/pipeline_tvm_inference.json';

    /* Start TVM inference */
    app.get('/tvm-inference/run', (req, res) => {
        console.log('[tvm-inference] /run request received');
        if (isRunning) {
            return res.status(400).json({ error: 'Inference already running', status: 'running' });
        }

        if (MOCK) {
            return res.json({ status: 'error', message: 'TVM inference requires real hardware - MOCK mode not supported' });
        }

        isRunning = true;
        inferenceResults = null;

        console.log('[tvm-inference] spawning:', binary, jsonFile);
        inferenceProcess = spawn(binary, [jsonFile]);

        let stdout = '';
        let stderr = '';

        inferenceProcess.stdout.on('data', data => {
            const text = data.toString();
            stdout += text;
            console.log('[tvm-inference] stdout:', text.trim());
        });

        inferenceProcess.stderr.on('data', data => {
            const text = data.toString();
            stderr += text;
            console.log('[tvm-inference] stderr:', text.trim());
        });

        inferenceProcess.on('close', code => {
            isRunning = false;
            inferenceProcess = null;
            console.log('[tvm-inference] process exited with code:', code);

            if (code === 0) {
                inferenceResults = parseInferenceOutput(stdout, stderr);
            } else {
                inferenceResults = {
                    error: `Inference failed with exit code ${code}`,
                    stdout,
                    stderr
                };
            }

            if (wss && wss.clients) {
                const message = JSON.stringify({ type: 'tvm-inference-complete', data: inferenceResults });
                wss.clients.forEach(client => {
                    if (client.readyState === 1) client.send(message);
                });
            }
        });

        inferenceProcess.on('error', error => {
            isRunning = false;
            inferenceProcess = null;
            console.error('[tvm-inference] spawn error:', error.message);
            inferenceResults = { error: error.message, stdout, stderr };
        });

        res.json({ status: 'started', message: 'TVM inference started on C7x DSP' });
    });

    /* Get inference status and results */
    app.get('/tvm-inference/status', (req, res) => {
        res.json({ isRunning, results: inferenceResults, hasResults: inferenceResults !== null });
    });

    /* Stop inference (if running) */
    app.get('/tvm-inference/stop', (req, res) => {
        if (inferenceProcess) {
            inferenceProcess.kill('SIGTERM');
            inferenceProcess = null;
            isRunning = false;
            res.json({ status: 'stopped', message: 'Inference stopped' });
        } else {
            res.json({ status: 'not_running', message: 'No inference process running' });
        }
    });

    console.log('[tvm-inference] plugin registered, binary:', binary, 'json:', jsonFile);
};

/*
 * Parse rpmsg_inference_example output.
 * stdout lines like:
 *   [TVM] Inference done in 18064.2 ms, output: 129122 floats
 *   [App] Pipeline completed successfully
 * stderr lines like:
 *   TVM AM62D: infer graph=0 cycles=15330081237 outputs=1
 */
function parseInferenceOutput(stdout, stderr) {
    const results = { timestamp: new Date().toISOString() };

    const inferenceTimeMatch = stdout.match(/Inference done in\s+([\d.]+)\s*ms/i);
    const outputFloatsMatch  = stdout.match(/output:\s*(\d+)\s*floats/i);
    const cyclesMatch        = (stderr || '').match(/cycles=(\d+)/);
    const successMatch       = /Pipeline completed successfully/i.test(stdout);

    if (inferenceTimeMatch) results.inferenceTimeMs = parseFloat(inferenceTimeMatch[1]);
    if (outputFloatsMatch)  results.outputFloats    = parseInt(outputFloatsMatch[1]);
    if (cyclesMatch)        results.cycles          = cyclesMatch[1];
    results.success = successMatch;

    return results;
}
