/*
 * Copyright (C) 2026 Texas Instruments Incorporated - http://www.ti.com/
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * @file spectrum_utils.c
 * @brief Live PCM streaming proxy for the AM62D speech-enhancement spectrogram.
 *
 * Connects to the edge-AI pipeline's Unix domain socket
 * (/tmp/edge-ai-speech.sock by default) and reads the EASP binary frames
 * produced by pipeline_manager.cpp at each model-inference boundary.
 *
 * Pipeline model parameters (GCRN @ 16 kHz):
 *   FRAMES_PER_BATCH = 401  one application chunk: 6 model inferences × 64 frames + 17 tail
 *   HOP_SAMPLES      = 100  STFT hop size (10 ms at 16 kHz)
 *   TAIL_FRAMES      = 17   trailing zero-padded frames appended to every batch
 *   VALID_FRAMES     = 384  (401 − 17) — frames carrying real enhanced audio per full chunk
 *   CHUNK_BYTES      = 76800 (384 × 100 × 2) valid PCM bytes per normal batch
 *
 * EASP wire format sent by pipeline_manager.cpp (13-byte header + payload):
 * @verbatim
 *   Bytes  0-3  : magic 'E','A','S','P'
 *   Byte   4    : direction  0=input  1=output
 *   Bytes  5-8  : uint32 LE  sample rate (always 16000)
 *   Bytes  9-12 : uint32 LE  payload length in bytes
 *   Bytes 13..  : S16LE PCM  (FRAMES_PER_BATCH × HOP_SAMPLES × 2 bytes normally)
 * @endverbatim
 *
 * Why 17 trailing frames are discarded:
 *   The GCRN model requires TAIL_FRAMES of future-context to produce a valid
 *   output frame.  The pipeline pads every inference block with TAIL_FRAMES
 *   zero frames so the model can flush its state; those zero frames appear as
 *   silence in the ISTFT output.  Trimming them keeps the visualisation free
 *   of periodic silence gaps.  The very last inference block of a file may
 *   carry more or fewer zero-padded frames depending on audio length — the
 *   fixed trim is applied there too (acceptable; any residual zeros appear as
 *   a brief tail-silence, not a repeated artefact).
 *
 * Stdout frame format (read by the Node.js server plugin):
 * @verbatim
 *   Byte  0     : direction  (0x00=input, 0x01=output)
 *   Bytes 1..N  : S16LE PCM  (valid_bytes; N=CHUNK_BYTES for normal batches)
 * @endverbatim
 *
 * @par Usage
 * @code
 *   spectrum_utils [socket_path]
 *   spectrum_utils /tmp/edge-ai-speech.sock
 * @endcode
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/un.h>

/* ------------------------------------------------------------------ */
/*  Pipeline inference constants                                       */
/* ------------------------------------------------------------------ */

/** Pipeline audio sample rate (matches the rate field in every EASP header). */
#define SAMPLE_RATE         16000

/**
 * Total STFT frames in one application chunk sent over the EASP socket.
 * = 6 model inferences × 64 frames + 17 tail frames = 401.
 */
#define FRAMES_PER_BATCH    401

/** STFT hop size in PCM samples (10 ms at 16 kHz). */
#define HOP_SAMPLES         100

/**
 * Trailing zero-padded STFT frames appended to every inference batch.
 * These represent future-context padding required by the GCRN model and
 * produce silence in the ISTFT output — they must be discarded.
 */
#define TAIL_FRAMES         17

/** Valid STFT output frames per full chunk = FRAMES_PER_BATCH − TAIL_FRAMES. */
#define VALID_FRAMES        (FRAMES_PER_BATCH - TAIL_FRAMES)

/**
 * Valid PCM bytes per normal chunk.
 * = VALID_FRAMES × HOP_SAMPLES × sizeof(int16_t) = 384 × 100 × 2 = 76800.
 */
#define CHUNK_BYTES         (VALID_FRAMES * HOP_SAMPLES * 2)

/**
 * Zero-padded tail bytes trimmed from every chunk.
 * = TAIL_FRAMES × HOP_SAMPLES × sizeof(int16_t) = 17 × 100 × 2 = 3400.
 */
#define TAIL_BYTES          (TAIL_FRAMES * HOP_SAMPLES * 2)

/** Maximum expected EASP payload (full batch + generous headroom). */
#define MAX_PAYLOAD         (FRAMES_PER_BATCH * HOP_SAMPLES * 2 + 512)

/** EASP header size in bytes. */
#define EASP_HDR_SIZE       13

/** Default Unix domain socket path (pipeline_manager.cpp uses the same). */
#define DEFAULT_SOCKET      "/tmp/edge-ai-speech.sock"

/* ------------------------------------------------------------------ */
/*  EASP header layout                                                  */
/* ------------------------------------------------------------------ */

typedef struct __attribute__((packed)) {
    char     magic[4];   /**< Must be 'E','A','S','P'. */
    uint8_t  direction;  /**< 0 = input (pre-STFT), 1 = output (post-ISTFT). */
    uint32_t rate;       /**< Sample rate, little-endian (always 16000). */
    uint32_t bytes;      /**< Payload length in bytes, little-endian. */
} easp_header_t;

/* ------------------------------------------------------------------ */
/*  Signal handling                                                     */
/* ------------------------------------------------------------------ */

static volatile int g_running = 1;

static void signal_handler(int sig)
{
    (void)sig;
    g_running = 0;
}

/* ------------------------------------------------------------------ */
/*  I/O helpers                                                         */
/* ------------------------------------------------------------------ */

/**
 * @brief Blocking read of exactly @p n bytes from @p fd.
 *
 * Retries on EINTR and partial reads until all bytes are received or
 * g_running is cleared.
 *
 * @return @p n on success, 0 on clean EOF, -1 on error.
 */
static ssize_t read_full(int fd, void *buf, size_t n)
{
    size_t done = 0;
    while (done < n && g_running) {
        ssize_t r = read(fd, (char *)buf + done, n - done);
        if (r == 0) return (ssize_t)done; /* EOF */
        if (r < 0) return -1;
        done += (size_t)r;
    }
    return (ssize_t)done;
}

/**
 * @brief Drain and discard @p n bytes from @p fd.
 * @return 0 on success, -1 on read error.
 */
static int drain(int fd, size_t n)
{
    char tmp[256];
    while (n > 0 && g_running) {
        size_t chunk = n < sizeof(tmp) ? n : sizeof(tmp);
        ssize_t r = read(fd, tmp, chunk);
        if (r <= 0) return -1;
        n -= (size_t)r;
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/*  Streaming loop                                                      */
/* ------------------------------------------------------------------ */

/**
 * @brief Read EASP frames from @p fd, strip zero-padded tail, write to stdout.
 *
 * Processing per frame:
 *  1. Read 13-byte EASP header; validate magic bytes.
 *  2. Read the PCM payload (header.bytes bytes).
 *  3. Discard the last TAIL_BYTES (TAIL_FRAMES × HOP_SAMPLES × 2) bytes.
 *     For the last inference block of a file the pipeline may pad with more
 *     zeros; the fixed trim is still applied — any residual silence is brief
 *     and non-repetitive.
 *  4. Write: direction_byte (1 B) + valid_pcm (valid_bytes B) to stdout.
 *
 * @param fd  Connected Unix socket file descriptor.
 */
static void stream_loop(int fd)
{
    uint8_t *payload = (uint8_t *)malloc(MAX_PAYLOAD);
    if (!payload) { perror("[spectrum] malloc"); return; }

    while (g_running) {

        /* ---- read EASP header ---- */
        easp_header_t hdr;
        ssize_t nr = read_full(fd, &hdr, EASP_HDR_SIZE);
        if (nr == 0) break;          /* clean EOF — pipeline finished */
        if (nr < EASP_HDR_SIZE) break;

        if (memcmp(hdr.magic, "EASP", 4) != 0) {
            /* Out-of-sync: skip one byte and attempt resync */
            fprintf(stderr, "[spectrum] bad EASP magic — resyncing\n");
            char dummy;
            read(fd, &dummy, 1);
            continue;
        }

        /* header fields are little-endian; on ARM32/64 this is native */
        uint32_t payload_bytes = hdr.bytes;
        uint8_t  direction     = hdr.direction;

        if (payload_bytes == 0 || payload_bytes > MAX_PAYLOAD) {
            fprintf(stderr, "[spectrum] unexpected payload size %u — skipping frame\n",
                    payload_bytes);
            if (payload_bytes > 0) drain(fd, payload_bytes);
            continue;
        }

        /* ---- read PCM payload ---- */
        nr = read_full(fd, payload, payload_bytes);
        if (nr < (ssize_t)payload_bytes) break;

        /* ---- strip zero-padded tail ---- */
        uint32_t valid_bytes = payload_bytes > TAIL_BYTES
                               ? payload_bytes - TAIL_BYTES
                               : 0u; /* degenerate: last micro-block */

        if (valid_bytes == 0) continue;

        /* ---- write stdout frame: direction + valid PCM ---- */
        if (fwrite(&direction, 1, 1, stdout) != 1) break;
        if (fwrite(payload, 1, valid_bytes, stdout) != valid_bytes) break;
        fflush(stdout);

        fprintf(stderr, "[spectrum] dir=%u  rate=%u  payload=%u  valid=%u\n",
                direction, hdr.rate, payload_bytes, valid_bytes);
    }

    free(payload);
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * @brief Connect to the edge-AI pipeline socket and stream valid PCM to stdout.
 *
 * Constants in effect:
 *   SAMPLE_RATE=%d  FRAMES_PER_BATCH=%d  HOP_SAMPLES=%d
 *   TAIL_FRAMES=%d  VALID_FRAMES=%d  CHUNK_BYTES=%d
 *
 * @param argc  Argument count.
 * @param argv  argv[1] optionally overrides the socket path.
 * @return 0 on clean exit, 1 on error.
 */
int main(int argc, char *argv[])
{
    const char *sock_path = argc >= 2 ? argv[1] : DEFAULT_SOCKET;

    signal(SIGTERM, signal_handler);
    signal(SIGINT,  signal_handler);

    fprintf(stderr,
            "[spectrum] SAMPLE_RATE=%d  FRAMES_PER_BATCH=%d  HOP_SAMPLES=%d\n"
            "[spectrum] TAIL_FRAMES=%d  VALID_FRAMES=%d  CHUNK_BYTES=%d\n",
            SAMPLE_RATE, FRAMES_PER_BATCH, HOP_SAMPLES,
            TAIL_FRAMES, VALID_FRAMES, CHUNK_BYTES);

    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) { perror("[spectrum] socket"); return 1; }

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, sock_path, sizeof(addr.sun_path) - 1);

    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        fprintf(stderr, "[spectrum] cannot connect to %s: %m\n", sock_path);
        close(fd);
        return 1;
    }

    fprintf(stderr, "[spectrum] connected to %s\n", sock_path);
    stream_loop(fd);
    close(fd);
    fprintf(stderr, "[spectrum] disconnected\n");
    return 0;
}
