/*
 * Copyright (C) 2026 Texas Instruments Incorporated - http://www.ti.com/
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * TVM inference demo server plugin
 * Registers: GET /tvm-inference/run, GET /tvm-inference/status
 * Supports MOCK=1 env var for development on x86 without target binaries.
 */

'use strict';

const { exec, spawn } = require('child_process');
const path = require('path');

const MOCK = process.env.MOCK === '1';

let inferenceProcess = null;
let inferenceResults = null;
let isRunning = false;

module.exports = function registerTvmInference(app, wss, device) {

    /* Start TVM inference */
    app.get('/tvm-inference/run', (req, res) => {
        if (isRunning) {
            return res.status(400).json({
                error: 'Inference already running',
                status: 'running'
            });
        }

        if (MOCK) {
            return res.json({
                status: 'error',
                message: 'TVM inference requires real hardware - MOCK mode not supported for this demo'
            });
        }

        // Real execution
        isRunning = true;
        inferenceResults = null;

        // Change to /root directory and run the inference
        const command = 'tvm_inference_client';
        const args = ['-a', 'artifacts_mobilenet_v2_tv-onnx/'];
        const options = {
            cwd: '/root',
            shell: true
        };

        console.log('[tvm-inference] Starting inference:', command, args.join(' '));

        inferenceProcess = spawn(command, args, options);

        let stdout = '';
        let stderr = '';

        inferenceProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log('[tvm-inference] stdout:', data.toString());
        });

        inferenceProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            console.log('[tvm-inference] stderr:', data.toString());
        });

        inferenceProcess.on('close', (code) => {
            isRunning = false;
            inferenceProcess = null;

            console.log('[tvm-inference] Process exited with code:', code);

            if (code === 0) {
                // Parse the output for results
                try {
                    inferenceResults = parseInferenceOutput(stdout);

                    // Broadcast results to WebSocket clients
                    if (wss && wss.clients) {
                        const message = JSON.stringify({
                            type: 'tvm-inference-complete',
                            data: inferenceResults
                        });
                        wss.clients.forEach(client => {
                            if (client.readyState === 1) { // WebSocket.OPEN = 1
                                client.send(message);
                            }
                        });
                    }
                } catch (error) {
                    console.error('[tvm-inference] Failed to parse results:', error);
                    inferenceResults = {
                        error: 'Failed to parse inference results',
                        stdout: stdout,
                        stderr: stderr
                    };
                }
            } else {
                inferenceResults = {
                    error: `Inference failed with exit code ${code}`,
                    stdout: stdout,
                    stderr: stderr
                };
            }
        });

        inferenceProcess.on('error', (error) => {
            isRunning = false;
            inferenceProcess = null;
            console.error('[tvm-inference] Process error:', error);

            inferenceResults = {
                error: error.message,
                stdout: stdout,
                stderr: stderr
            };
        });

        res.json({
            status: 'started',
            message: 'TVM inference started on C7x DSP'
        });
    });

    /* Get inference status and results */
    app.get('/tvm-inference/status', (req, res) => {
        res.json({
            isRunning: isRunning,
            results: inferenceResults,
            hasResults: inferenceResults !== null
        });
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
};

/**
 * Parse the TVM inference output to extract performance metrics and predictions
 */
function parseInferenceOutput(output) {
    const results = {
        timestamp: new Date().toISOString()
    };

    // Extract performance metrics
    const avgTimeMatch = output.match(/Average:\s+([\d.]+)\s*ms/);
    const fpsMatch = output.match(/FPS:\s+([\d.]+)/);
    const minTimeMatch = output.match(/Min:\s+([\d.]+)\s*ms/);
    const maxTimeMatch = output.match(/Max:\s+([\d.]+)\s*ms/);
    const outputShapeMatch = output.match(/Raw output shape:\s*(\([^)]+\))/);

    if (avgTimeMatch) results.averageTime = avgTimeMatch[1];
    if (fpsMatch) results.fps = fpsMatch[1];
    if (minTimeMatch) results.minTime = minTimeMatch[1];
    if (maxTimeMatch) results.maxTime = maxTimeMatch[1];
    if (outputShapeMatch) results.outputShape = outputShapeMatch[1];

    // Extract top 5 predictions
    const predictions = [];
    const classMatches = output.matchAll(/(\d+)\.\s+Class\s+(\d+):\s+([\d.]+)\s+\(([\d.]+)%\)/g);

    for (const match of classMatches) {
        predictions.push({
            rank: parseInt(match[1]),
            class: parseInt(match[2]),
            score: parseFloat(match[3]),
            percentage: match[4] + '%'
        });
    }

    if (predictions.length > 0) {
        results.predictions = predictions;
    }

    return results;
}