/*
 * Copyright (C) 2026 Texas Instruments Incorporated - http://www.ti.com/
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *
 * Redistributions in binary form must reproduce the above copyright
 * notice, this list of conditions and the following disclaimer in the
 * documentation and/or other materials provided with the distribution.
 *
 * Neither the name of Texas Instruments Incorporated nor the names of
 * its contributors may be used to endorse or promote products derived
 * from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file speech_utils.c
 * @brief Speech-to-text utility for the TI AM62D demo portal.
 *
 * Enumerates ALSA capture devices and drives a GStreamer NNStreamer
 * pipeline that performs real-time speech-to-text using the Silero
 * en_v5.onnx model via ONNX Runtime.  Transcripts are written to a
 * named FIFO consumed by the Node.js webserver plugin and forwarded
 * to the browser over WebSocket.
 *
 * Pipeline (live device source):
 * @code
 *   alsasrc → audioconvert → tensor_converter → tensor_aggregator
 *   → tensor_transform (S16LE→F32, normalise) → tensor_filter (onnxruntime)
 *   → tensor_sink (greedy CTC decode) → FIFO
 * @endcode
 *
 * Output FIFO : /tmp/speech_classification_fifo  (one transcript per flush)
 * PID file    : /tmp/speech_classification.pid
 *
 * @par Usage
 * @code
 *   speech_utils devices
 *   speech_utils start_gst [device]   # e.g. plughw:1,0
 *   speech_utils stop_gst
 *   speech_utils status
 * @endcode
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>

/* ------------------------------------------------------------------ */
/*  Audio device helpers                                               */
/* ------------------------------------------------------------------ */
#define MAX_DEVICES 10

typedef struct {
    char display_name[128];
    char alsa_device[128];
} audio_device_info;

static audio_device_info audio_devices[MAX_DEVICES];
static int device_count = 0;

/**
 * @brief Parse one line of @c arecord @c -l / @c aplay @c -l output.
 *
 * Expected format:
 * @verbatim
 * card N: SHORT [CARD_NAME], device D: LONG_NAME SHORT_NAME [...]
 * @endverbatim
 *
 * On success, populates @c audio_devices[device_count] with the
 * @c plughw:N,D ALSA identifier and a @c "CARD_NAME: DEV_SHORT"
 * display name.  Devices matching HDMI, webcam, camera, or cape
 * patterns are silently skipped.
 *
 * @param line  Null-terminated line from arecord/aplay output.
 * @return 1 if a valid device entry was populated, 0 to skip.
 */
static int parse_alsa_line(const char *line)
{
    int card_num = -1, dev_num = -1;
    char card_name[128] = {0};
    char dev_short[128] = {0};

    if (strncmp(line, "card", 4) != 0) return 0;

    const char *dev_str = strstr(line, ", device ");
    if (!dev_str) return 0;

    sscanf(line, "card %d:", &card_num);
    if (card_num < 0) return 0;

    const char *ns = strchr(line, '[');
    const char *ne = ns ? strchr(ns, ']') : NULL;
    if (!ns || !ne || ne <= ns) return 0;
    int nl = (int)(ne - ns - 1);
    if (nl <= 0 || nl >= (int)sizeof(card_name)) return 0;
    strncpy(card_name, ns + 1, nl);
    card_name[nl] = '\0';

    if (strstr(card_name, "HDMI")   || strstr(card_name, "hdmi")   ||
        strstr(card_name, "cape")   ||
        strstr(card_name, "Webcam") || strstr(card_name, "webcam") ||
        strstr(card_name, "Camera") || strstr(card_name, "camera")) {
        fprintf(stderr, "Skipping device: %s\n", card_name);
        return 0;
    }

    sscanf(dev_str, ", device %d:", &dev_num);
    if (dev_num < 0) return 0;

    const char *p = strchr(dev_str, ':');
    if (!p) return 0;
    p++;
    while (*p == ' ') p++;
    while (*p && *p != ' ') p++;
    while (*p == ' ') p++;
    int di = 0;
    while (*p && *p != ' ' && *p != '[' && *p != '\n' && di < 127)
        dev_short[di++] = (char)*p++;
    dev_short[di] = '\0';
    if (di == 0) return 0;

    char display[256];
    snprintf(display, sizeof(display), "%s: %s", card_name, dev_short);

    strncpy(audio_devices[device_count].display_name, display,
            sizeof(audio_devices[device_count].display_name) - 1);
    snprintf(audio_devices[device_count].alsa_device,
             sizeof(audio_devices[device_count].alsa_device),
             "plughw:%d,%d", card_num, dev_num);

    fprintf(stderr, "Found device: %s -> %s\n",
            display, audio_devices[device_count].alsa_device);
    return 1;
}

/**
 * @brief Enumerate ALSA recording devices via @c arecord @c -l.
 *
 * Runs @c arecord @c -l, parses every card+device combination through
 * parse_alsa_line(), and populates the module-static @c audio_devices[]
 * array and @c device_count.  Prints an error message to stdout if
 * @c arecord is unavailable or no devices are found.
 */
static void get_arecord_devices(void)
{
    FILE *fp;
    char line[512];

    device_count = 0;
    memset(audio_devices, 0, sizeof(audio_devices));

    fp = popen("arecord -l 2>/dev/null", "r");
    if (!fp) {
        printf("Error running arecord command\n");
        return;
    }

    while (fgets(line, sizeof(line), fp) && device_count < MAX_DEVICES) {
        if (parse_alsa_line(line))
            device_count++;
    }
    pclose(fp);

    if (device_count == 0)
        printf("No audio input devices found\n");
}

/* ------------------------------------------------------------------ */
/*  main                                                                */
/* ------------------------------------------------------------------ */
/**
 * @brief Entry point – dispatches to the requested sub-command.
 *
 * | argv[1]  | Behaviour |
 * |----------|-----------|
 * | devices  | Print all ALSA capture devices as @c "plughw:C,D|NAME\\n" |
 *
 * @param argc  Argument count.
 * @param argv  Argument vector.
 * @return 0 on success, 1 on unrecognised command.
 */
int main(int argc, char *argv[])
{
    if (argc > 1 && strcmp(argv[1], "devices") == 0) {
        get_arecord_devices();
        for (int i = 0; i < device_count; i++)
            printf("%s|%s\n",
                   audio_devices[i].alsa_device,
                   audio_devices[i].display_name);
        return 0;
    }

    printf("Usage:\n");
    printf("  %s devices              - List audio recording devices\n", argv[0]);
    return 1;
}
