include ../../../common/linux_app/Makefile.common

# Enable the AM62D ALSA device parser in the shared audio utility.  Other
# devices retain the original implementation in the same source file.
CFLAGS += -DAM62DXX

#GST_CFLAGS := $(shell pkg-config --cflags gstreamer-1.0 2>/dev/null)
#GST_LIBS   := $(shell pkg-config --libs   gstreamer-1.0 2>/dev/null)

TARGETS = audio_utils speech_utils spectrum_utils

all: $(TARGETS)

audio_utils: ../../../common/linux_app/audio_utils.c
	$(CC) $(CFLAGS) ../../../common/linux_app/audio_utils.c -o audio_utils -pthread $(LDFLAGS)

speech_utils: speech_utils.c
	$(CC) $(CFLAGS) speech_utils.c -o speech_utils -pthread $(LDFLAGS)

spectrum_utils: ../../../common/linux_app/spectrum_utils.c
	$(CC) $(CFLAGS) ../../../common/linux_app/spectrum_utils.c -o spectrum_utils -lm $(LDFLAGS)

clean:
	rm -f $(TARGETS)
