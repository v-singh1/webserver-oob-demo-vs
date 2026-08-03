include Makefile.common

TARGETS = cpu_stats spectrum_utils

cpu_stats: cpu_stats.c
	$(CC) $(CFLAGS) cpu_stats.c -o cpu_stats -lm $(LDFLAGS)

spectrum_utils: spectrum_utils.c
	$(CC) $(CFLAGS) spectrum_utils.c -o spectrum_utils -lm $(LDFLAGS)

all: $(TARGETS)

clean:
	rm -f $(TARGETS)
