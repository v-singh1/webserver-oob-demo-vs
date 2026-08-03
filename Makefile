# Root Makefile — webserver-oob-demo multi-device build
#
# Usage:
#   make                           Build for default device (am335x) on native host
#   make DEVICE=am62x              Build for am62x
#   make CC=arm-linux-gnueabihf-gcc Cross-compile for ARM target
#   make dev                       Run server locally (no cross-compile)
#   make dev MOCK=1                Run server with mock data (no target binaries needed)
#   make deploy BOARD_HOST=root@192.168.7.2  Deploy to board via SSH
#   make clean                     Remove build artifacts

DEVICE     ?= am335x
CC         ?= gcc
INSTALL_DIR = /usr/share/webserver-oob
NODE_PKG    = /usr/lib/node_modules/webserver-oob

# Auto-discover board IP unless BOARD_HOST is explicitly set.
# Scans ARP cache for a host serving port 3000 /device-info.
# Override: make deploy BOARD_HOST=root@<ip>
BOARD_HOST ?= $(shell bash tools/find-board.sh 2>/dev/null || echo root@192.168.7.2)

export CC CFLAGS LDFLAGS

.PHONY: all build deps build-native clean dev deploy \
        deploy-bins deploy-server deploy-app deploy-restart \
        push push-server push-app find-board

all: build

build: deps build-native

deps:
	cd common/webserver && npm install

build-native:
	$(MAKE) -C common/linux_app
	@if [ -d devices/$(DEVICE)/linux_app ]; then \
	    $(MAKE) -C devices/$(DEVICE)/linux_app; \
	fi

clean:
	$(MAKE) -C common/linux_app clean
	@if [ -d devices/$(DEVICE)/linux_app ]; then \
	    $(MAKE) -C devices/$(DEVICE)/linux_app clean; \
	fi


# ── Local development ────────────────────────────────────────────────

# Run server locally using device config (no cross-compile needed).
# Set MOCK=1 to use mock data instead of real native binaries.
dev: deps
	DEVICE_CONFIG=$(CURDIR)/devices/$(DEVICE)/device.json \
	MOCK=$(MOCK) \
	    node common/webserver/server.js $(CURDIR)/common/app

# Run with full mock (fake CPU stats + fake audio devices)
dev-mock: MOCK=1
dev-mock: dev

# ── Deploy to board via SSH ──────────────────────────────────────────

deploy: build deploy-bins deploy-server deploy-app
	@echo "Deploy complete. Run 'make deploy-restart' to restart the service."

deploy-bins:
	ssh $(BOARD_HOST) "mkdir -p /usr/bin"
	scp common/linux_app/cpu_stats $(BOARD_HOST):/usr/bin/cpu_stats
	@if [ -f devices/$(DEVICE)/linux_app/audio_utils ]; then \
	    scp devices/$(DEVICE)/linux_app/audio_utils $(BOARD_HOST):/usr/bin/audio_utils; \
	fi
	@if [ -f devices/$(DEVICE)/linux_app/rpmsg_json ]; then \
	    scp devices/$(DEVICE)/linux_app/rpmsg_json $(BOARD_HOST):/usr/bin/rpmsg_json; \
	fi

deploy-server:
	ssh $(BOARD_HOST) "rm -rf $(INSTALL_DIR)/server $(INSTALL_DIR)/demos && \
	    mkdir -p $(INSTALL_DIR)/server $(INSTALL_DIR)/demos"
	tar -C common/webserver -cf - . | \
	    ssh $(BOARD_HOST) "tar -C $(INSTALL_DIR)/server -xf -"
	tar -C demos -cf - . | \
	    ssh $(BOARD_HOST) "tar -C $(INSTALL_DIR)/demos -xf -"
	ssh $(BOARD_HOST) "\
	    echo 'DEVICE_CONFIG=$(INSTALL_DIR)/app/device.json' > /etc/webserver-oob.conf && \
	    echo 'APP_DIR=$(INSTALL_DIR)/app' >> /etc/webserver-oob.conf && \
	    echo 'DEMOS_DIR=$(INSTALL_DIR)/demos' >> /etc/webserver-oob.conf"
	# Sync server.js to the node package path where the systemd service runs it
	scp common/webserver/server.js $(BOARD_HOST):$(NODE_PKG)/server.js

deploy-app:
	ssh $(BOARD_HOST) "rm -rf $(INSTALL_DIR)/app && mkdir -p $(INSTALL_DIR)/app"
	tar -C common/app --exclude components/.git -cf - . | \
	    ssh $(BOARD_HOST) "tar -C $(INSTALL_DIR)/app -xf -"
	@if [ -d devices/$(DEVICE)/app ]; then \
	    tar -C devices/$(DEVICE)/app -cf - . | \
	        ssh $(BOARD_HOST) "tar -C $(INSTALL_DIR)/app -xf -"; \
	fi
	scp devices/$(DEVICE)/device.json $(BOARD_HOST):$(INSTALL_DIR)/app/device.json

deploy-restart:
	ssh $(BOARD_HOST) "systemctl restart webserver-oob"

# ── Quick push (no build — just sync changed web files and restart) ──

push: push-server push-app deploy-restart
	@echo "Push complete."

push-server:
	@echo "Board: $(BOARD_HOST)"
	scp common/webserver/server.js $(BOARD_HOST):$(NODE_PKG)/server.js

push-app:
	@echo "Board: $(BOARD_HOST)"
	scp common/app/index.html common/app/audio-dsp.html common/app/model-inspector.html \
	    $(BOARD_HOST):$(INSTALL_DIR)/app/
	@if [ -d devices/$(DEVICE)/app ]; then \
	    scp -r devices/$(DEVICE)/app/. $(BOARD_HOST):$(INSTALL_DIR)/app/; \
	fi

find-board:
	@bash tools/find-board.sh

# ── Info ─────────────────────────────────────────────────────────────

info:
	@echo "Device:      $(DEVICE)"
	@echo "CC:          $(CC)"
	@echo "BOARD_HOST:  $(BOARD_HOST)"
	@echo "INSTALL_DIR: $(INSTALL_DIR)"
	@echo "Demos dir:   $(CURDIR)/demos"
	@echo "Device dir:  $(CURDIR)/devices/$(DEVICE)"
