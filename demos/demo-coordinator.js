'use strict';

/*
 * demo-coordinator.js
 *
 * Shared in-process module for the three C7x DSP coordination concerns:
 *
 *  1. Mutual exclusion — only one DSP demo runs at a time.  All plugins share
 *     the same Node.js process, so a single module-level variable is enough.
 *
 *  2. TVM preload — before an edge-ai demo spawns rpmsg_inference_example it
 *     must ensure the TVM model is already loaded on the C7x.  If the cache
 *     file is absent this module runs the binary with --preload synchronously.
 *
 *  3. TVM cache invalidation — DSP compute demos (2dfft, audio-offload,
 *     sigchain-biquad) load their own firmware onto the C7x, overwriting the
 *     TVM model.  When they exit the cache file is deleted so the next
 *     edge-ai run knows it must preload again.
 */

const fs                         = require('fs');
const { execFileSync, execFile } = require('child_process');

const TVM_DAEMON_SERVICE = 'tvm-model-daemon';

const TVM_CACHE   = '/var/lib/tvm_inference/loaded_model';
const PRELOAD_BIN = '/usr/bin/rpmsg_inference_example';

// Name of the demo that currently owns the C7x DSP, or null.
let _activeDemoName = null;

// 'ready' | 'restarting' — tracks tvm-model-daemon lifecycle
let _tvmDaemonState = 'ready';

module.exports = {

    /**
     * Try to acquire the C7x DSP for the named demo.
     * @returns {string|null} null on success, or an error message if busy.
     */
    acquireDsp(demoName) {
        if (_activeDemoName)
            return `C7x DSP is busy: '${_activeDemoName}' is already running`;
        _activeDemoName = demoName;
        return null;
    },

    /** Release the DSP.  No-op if this demo does not currently own it. */
    releaseDsp(demoName) {
        if (_activeDemoName === demoName) _activeDemoName = null;
    },

    /** Returns the name of the demo that currently owns the DSP, or null. */
    activeDemo() { return _activeDemoName; },

    /**
     * Ensure the TVM model is preloaded onto the C7x DSP.
     * If the cache file is absent, runs `<binary> --preload` synchronously.
     * Throws on preload failure so the caller can surface a clean error.
     *
     * @param {string} [binaryPath]  Override path to rpmsg_inference_example.
     */
    ensurePreloaded(binaryPath) {
        if (fs.existsSync(TVM_CACHE)) return;
        const bin = binaryPath || PRELOAD_BIN;
        console.log(`[demo-coordinator] TVM cache absent — running preload via ${bin}`);
        execFileSync(bin, ['--preload'], { timeout: 90000, stdio: 'inherit' });
        try {
            const path = require('path');
            const dir = path.dirname(TVM_CACHE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(TVM_CACHE, new Date().toISOString() + '\n');
        } catch (err) {
            console.warn('[demo-coordinator] Could not write TVM cache marker:', err.message);
        }
        console.log('[demo-coordinator] TVM preload completed');
    },

    /**
     * Delete the TVM model cache file and restart tvm-model-daemon so it
     * reloads the model after a DSP compute demo has overwritten C7x firmware.
     * Must be called from the exit handler of every DSP compute demo.
     */
    invalidateTvmCache() {
        try {
            if (fs.existsSync(TVM_CACHE)) {
                fs.unlinkSync(TVM_CACHE);
                console.log('[demo-coordinator] TVM model cache invalidated');
            }
        } catch (err) {
            console.warn('[demo-coordinator] Could not remove TVM cache:', err.message);
        }
        _tvmDaemonState = 'restarting';
        execFile('systemctl', ['restart', TVM_DAEMON_SERVICE], (err) => {
            if (err) {
                console.warn(`[demo-coordinator] Could not restart ${TVM_DAEMON_SERVICE}:`, err.message);
            } else {
                console.log(`[demo-coordinator] ${TVM_DAEMON_SERVICE} restarted`);
            }
            _tvmDaemonState = 'ready';
        });
    },

    /** Returns true if the TVM model cache file exists on disk. */
    tvmCacheExists() { return fs.existsSync(TVM_CACHE); },

    /** Returns current tvm-model-daemon state: 'ready' | 'restarting' */
    tvmDaemonState() { return _tvmDaemonState; },
};
