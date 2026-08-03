/*
 * Copyright (C) 2024 Texas Instruments Incorporated - http://www.ti.com/
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * @file spectrum_utils.c
 * @brief PCM streaming utility for real-time input/output spectrum visualization.
 *
 * Reads a 48 kHz S16LE mono WAV file (input) and an optional second WAV
 * file (output) in a loop.  Each iteration reads CHUNK_BYTES (1024 bytes /
 * 512 samples) from each file and writes a framed binary message to stdout:
 *
 * @verbatim
 *   Byte 0   : channel  (0x00 = input, 0x01 = output)
 *   Bytes 1-1024 : raw S16LE PCM samples (little-endian)
 * @endverbatim
 *
 * The Node.js webserver plugin reads stdout, decodes each 1025-byte frame,
 * and broadcasts the raw PCM over WebSocket so the browser can compute an
 * FFT and render the frequency spectrum.
 *
 * The loop repeats from the WAV data start when the end-of-file is reached,
 * providing continuous playback.  Timing is paced to 48 kHz real-time using
 * nanosleep() so the browser UI updates at approximately the audio rate.
 *
 * @par Usage
 * @code
 *   spectrum_utils <input.wav> [output.wav]
 * @endcode
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>

/** Number of PCM bytes read and streamed per iteration (512 S16LE samples). */
#define CHUNK_BYTES        1024

/** Expected sample rate of input WAV files. */
#define SAMPLE_RATE        48000

/**
 * Real-time sleep interval per chunk in nanoseconds.
 * 512 samples / 48000 Hz ≈ 10.666 ms.
 */
#define SAMPLES_PER_CHUNK  (CHUNK_BYTES / 2)
#define NS_PER_CHUNK       ((long)(SAMPLES_PER_CHUNK * 1000000000LL / SAMPLE_RATE))

/** Channel byte written before each PCM block for the input (noisy) audio. */
#define CHAN_INPUT   0x00

/** Channel byte written before each PCM block for the output (enhanced) audio. */
#define CHAN_OUTPUT  0x01

/* ------------------------------------------------------------------ */
/*  WAV header                                                          */
/* ------------------------------------------------------------------ */

/**
 * @brief Parsed subset of a WAV file header.
 */
typedef struct {
    uint32_t data_offset;     /**< Byte offset in the file where PCM data begins. */
    uint32_t data_size;       /**< Total PCM data bytes in the file.              */
    uint16_t channels;        /**< Number of audio channels.                      */
    uint32_t sample_rate;     /**< Sample rate in Hz.                             */
    uint16_t bits_per_sample; /**< Bit depth per sample.                          */
} wav_info_t;

static int read_le16(FILE *fp, uint16_t *out)
{
    uint8_t b[2];
    if (fread(b, 1, 2, fp) != 2) return -1;
    *out = (uint16_t)(b[0] | (b[1] << 8));
    return 0;
}

static int read_le32(FILE *fp, uint32_t *out)
{
    uint8_t b[4];
    if (fread(b, 1, 4, fp) != 4) return -1;
    *out = (uint32_t)(b[0] | ((uint32_t)b[1]<<8) | ((uint32_t)b[2]<<16) | ((uint32_t)b[3]<<24));
    return 0;
}

/**
 * @brief Parse the RIFF/WAVE header of a WAV file and locate the PCM data chunk.
 *
 * Iterates over all RIFF sub-chunks and stops when both the @c fmt  and
 * @c data chunks have been found.  Non-PCM audio formats (e.g. ADPCM, MP3)
 * are rejected.  Unknown chunks (LIST, INFO, etc.) are silently skipped.
 *
 * @param fp    Open FILE* positioned at the start of the WAV file.
 * @param info  Populated on success with sample rate, channel count,
 *              bit depth, PCM data offset and PCM data size.
 * @return 0 on success, -1 on parse error or unsupported format.
 */
static int parse_wav_header(FILE *fp, wav_info_t *info)
{
    char     tag[5] = {0};
    uint32_t chunk_size;
    uint16_t audio_format;

    if (fread(tag, 1, 4, fp) != 4 || memcmp(tag, "RIFF", 4) != 0) {
        fprintf(stderr, "[spectrum] Not a RIFF file\n");
        return -1;
    }
    if (read_le32(fp, &chunk_size) < 0) return -1;
    if (fread(tag, 1, 4, fp) != 4 || memcmp(tag, "WAVE", 4) != 0) {
        fprintf(stderr, "[spectrum] Not a WAVE file\n");
        return -1;
    }

    memset(info, 0, sizeof(*info));
    int found_fmt = 0, found_data = 0;

    while (!found_data) {
        if (fread(tag, 1, 4, fp) != 4) break;
        tag[4] = '\0';
        if (read_le32(fp, &chunk_size) < 0) break;

        if (memcmp(tag, "fmt ", 4) == 0) {
            if (read_le16(fp, &audio_format) < 0) return -1;
            if (audio_format != 1) {
                fprintf(stderr, "[spectrum] Only PCM (format 1) supported, got %u\n",
                        audio_format);
                return -1;
            }
            uint32_t byte_rate;
            uint16_t block_align;
            if (read_le16(fp, &info->channels)        < 0) return -1;
            if (read_le32(fp, &info->sample_rate)     < 0) return -1;
            if (read_le32(fp, &byte_rate)             < 0) return -1;
            if (read_le16(fp, &block_align)           < 0) return -1;
            if (read_le16(fp, &info->bits_per_sample) < 0) return -1;
            if (chunk_size > 16) fseek(fp, (long)(chunk_size - 16), SEEK_CUR);
            found_fmt = 1;

        } else if (memcmp(tag, "data", 4) == 0) {
            info->data_size   = chunk_size;
            info->data_offset = (uint32_t)ftell(fp);
            found_data = 1;

        } else {
            /* skip unknown chunk — pad to even byte boundary */
            fseek(fp, (long)(chunk_size + (chunk_size & 1)), SEEK_CUR);
        }
    }

    if (!found_fmt || !found_data) {
        fprintf(stderr, "[spectrum] Incomplete WAV (fmt=%d data=%d)\n",
                found_fmt, found_data);
        return -1;
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/*  Streaming                                                           */
/* ------------------------------------------------------------------ */

static volatile int g_running = 1;

/**
 * @brief Signal handler — clears g_running to stop the stream loop cleanly.
 * @param sig  Received signal number.
 */
static void signal_handler(int sig)
{
    (void)sig;
    g_running = 0;
}

/**
 * @brief Stream PCM frames from input (and optional output) WAV files to stdout.
 *
 * Each iteration:
 *  1. Reads CHUNK_BYTES from @p fin, zero-pads short reads.
 *  2. Writes @c CHAN_INPUT + 1024 PCM bytes to stdout.
 *  3. If @p fout is non-NULL: reads CHUNK_BYTES from @p fout,
 *     writes @c CHAN_OUTPUT + 1024 PCM bytes to stdout.
 *  4. Flushes stdout so the parent process receives the frames promptly.
 *  5. Sleeps NS_PER_CHUNK ns to pace output to real-time 48 kHz.
 *
 * Loops back to the WAV data start when the end of the file is reached.
 *
 * @param fin      Open FILE* for the input WAV, positioned at the PCM data.
 * @param fout     Open FILE* for the output WAV, or NULL if not provided.
 * @param in_off   Byte offset of the input PCM data start (for loop seek).
 * @param out_off  Byte offset of the output PCM data start (ignored if fout==NULL).
 */
static void stream_loop(FILE *fin, FILE *fout, uint32_t in_off, uint32_t out_off)
{
    uint8_t frame[1 + CHUNK_BYTES];
    struct timespec ts = { 0, NS_PER_CHUNK };

    while (g_running) {
        /* ---- input chunk ---- */
        size_t n = fread(frame + 1, 1, CHUNK_BYTES, fin);
        if (n == 0) {
            fseek(fin, (long)in_off, SEEK_SET);
            continue;
        }
        if (n < CHUNK_BYTES)
            memset(frame + 1 + n, 0, CHUNK_BYTES - n);

        frame[0] = CHAN_INPUT;
        if (fwrite(frame, 1, sizeof(frame), stdout) != sizeof(frame))
            break;

        /* ---- output chunk (optional) ---- */
        if (fout) {
            size_t m = fread(frame + 1, 1, CHUNK_BYTES, fout);
            if (m == 0) {
                fseek(fout, (long)out_off, SEEK_SET);
            } else {
                if (m < CHUNK_BYTES)
                    memset(frame + 1 + m, 0, CHUNK_BYTES - m);
                frame[0] = CHAN_OUTPUT;
                if (fwrite(frame, 1, sizeof(frame), stdout) != sizeof(frame))
                    break;
            }
        }

        fflush(stdout);
        nanosleep(&ts, NULL);
    }
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * @brief Entry point — validates WAV files and starts the stream loop.
 *
 * | argv[1] | Mandatory. Path to the input (noisy) 48 kHz mono S16LE WAV file. |
 * | argv[2] | Optional.  Path to the output (enhanced) WAV file.               |
 *
 * Validates that the input file is 48 kHz, mono, 16-bit PCM.  Exits with
 * an error message if the format is unsupported.
 *
 * @param argc  Argument count; must be 2 or 3.
 * @param argv  Argument vector.
 * @return 0 on clean exit, 1 on error.
 */
int main(int argc, char *argv[])
{
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <input.wav> [output.wav]\n", argv[0]);
        return 1;
    }

    /* ---- input WAV ---- */
    FILE *fin = fopen(argv[1], "rb");
    if (!fin) { perror(argv[1]); return 1; }

    wav_info_t in_info;
    if (parse_wav_header(fin, &in_info) < 0) { fclose(fin); return 1; }

    fprintf(stderr, "[spectrum] input: %u Hz, %u ch, %u bit, %u bytes\n",
            in_info.sample_rate, in_info.channels,
            in_info.bits_per_sample, in_info.data_size);

    if (in_info.sample_rate != SAMPLE_RATE || in_info.channels != 1
            || in_info.bits_per_sample != 16) {
        fprintf(stderr, "[spectrum] Require 48000 Hz mono 16-bit PCM\n");
        fclose(fin);
        return 1;
    }

    /* ---- output WAV (optional) ---- */
    FILE     *fout    = NULL;
    wav_info_t out_info;
    uint32_t  out_off = 0;

    if (argc >= 3) {
        fout = fopen(argv[2], "rb");
        if (!fout) {
            perror(argv[2]);
        } else if (parse_wav_header(fout, &out_info) < 0) {
            fclose(fout);
            fout = NULL;
        } else {
            out_off = out_info.data_offset;
            fprintf(stderr, "[spectrum] output: %u Hz, %u ch, %u bit, %u bytes\n",
                    out_info.sample_rate, out_info.channels,
                    out_info.bits_per_sample, out_info.data_size);
        }
    }

    signal(SIGTERM, signal_handler);
    signal(SIGINT,  signal_handler);

    fprintf(stderr, "[spectrum] streaming started (press Ctrl-C to stop)\n");
    stream_loop(fin, fout, in_info.data_offset, out_off);

    fclose(fin);
    if (fout) fclose(fout);
    fprintf(stderr, "[spectrum] stopped\n");
    return 0;
}
