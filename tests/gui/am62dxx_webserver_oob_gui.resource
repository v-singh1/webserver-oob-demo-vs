Language: English

*** Settings ***
Documentation     Shared keywords/variables for the AM62D WebServer OOB Demo (Vue/Vuetify) GUI
...               Robot suites - both the offline/MOCK suite (am62dxx_webserver_oob_gui_offline.robot),
...               which clones github.com/TexasInstruments/webserver-oob-demo (see
...               CLONE OR UPDATE WEBSERVER OOB DEMO REPO / ${DEMO_ROOT}) rather than relying on a
...               local checkout, and the EVM suite (am62dxx_webserver_oob_gui_evm.robot), which
...               drives whatever webserver-oob build is already deployed on the board. Selectors
...               here are class names taken from that repo's App.vue, AudioDsp.vue,
...               DspCompute.vue, ModelInspector.vue, and the demo components under
...               devices/am62dxx/ui/demos/ and frontend/src/demos/ - keep them in sync if that
...               frontend changes.
...               ui/demos/ now also includes GStreamerPipeline.vue (the "Custom Audio Pipeline"
...               tab, added upstream in place of the removed TVM Inference tab, which is
...               commented out of AudioDsp.vue's demos array) - it follows the same generic
...               .status-row/.page-hdr button pattern as the other demos.
...
...               One-time environment prerequisite (not automated by this resource):
...                   pip install robotframework-browser
...                   rfbrowser init
...
...               EVM suite only - proxy stripping: Chromium inherits HTTP_PROXY/HTTPS_PROXY
...               from the environment and will route the board's LAN address through any
...               configured proxy, returning a block page instead of the app. OPEN WEBSERVER
...               GUI strips all *proxy* variables from the environment dict passed to New
...               Browser so the browser connects directly to the board IP regardless of the
...               host's proxy settings.
# NOTE: common.resource and am62dxx.resource are intentionally NOT imported here.
# They pull in ASTRA proprietary libraries (astra.uart.dut, etc.) that are only available
# in the on-premises lab environment.  The offline test suite uses no EVM/UART keywords,
# so those imports are unnecessary and would break CI.  The EVM suite (not run in CI)
# imports them directly in its own .robot file.
Library           Browser    auto_closing_level=SUITE
Library           OperatingSystem    WITH NAME    OS
Library           Process
Library           String
Library           Collections

*** Variables ***
# The offline suite tests the canonical upstream webserver-oob-demo source, not whatever local
# working copy happens to be checked out - CLONE OR UPDATE WEBSERVER OOB DEMO REPO fetches this
# into ${DEMO_CLONE_DIR} before every offline run. Override the WEBSERVER_OOB_DEMO_ROOT OS
# environment variable (NOT a Robot -v variable - the %{...} syntax below reads the process
# environment only, so `robot -v WEBSERVER_OOB_DEMO_ROOT:<path>` is silently ignored; use
# `export WEBSERVER_OOB_DEMO_ROOT=<path>` before invoking robot instead) to point ${DEMO_ROOT} at
# a local checkout, e.g. to test in-progress local changes before they land on
# ${DEMO_REPO_BRANCH}; that skips the clone/update entirely.
${DEMO_REPO_URL}              https://github.com/TexasInstruments/webserver-oob-demo.git
${DEMO_REPO_BRANCH}           main
# Cached under CURDIR (not OUTPUT_DIR, which differs per run) so repeat runs reuse the clone/npm
# install/frontend build instead of redoing all of that from scratch every time.
${DEMO_CLONE_DIR}             %{WEBSERVER_OOB_DEMO_CLONE_DIR=${CURDIR}/.webserver-oob-demo-cache}
${DEMO_ROOT}                  %{WEBSERVER_OOB_DEMO_ROOT=${DEMO_CLONE_DIR}}
${WEBSERVER_PORT}             3000
${BROWSER_TYPE}               chromium
${HEADLESS}                   ${True}
# Network interface on the EVM whose IPv4 address the browser should target. Adjust per lab
# topology if the webserver-oob GUI is reached over a different interface than eth0.
${BOARD_NET_IFACE}            eth0
${TVM_READY_TIMEOUT}          60s

# ---- Selectors (see am62dxx_webserver_oob_gui.resource Documentation above) ----
${SEL_CONN_TXT}               .conn-txt
${SEL_NAV_ITEM}                .nav-item
${SEL_DSI}                    .dsi
${SEL_DEMO_HDR_BTN}           .page-hdr button
${SEL_PREPARING_ALERT}        .preparing-alert
${SEL_MODEL_LOADING_ALERT}    .model-loading-alert
# Generic status-text selector: every demo panel (SpeechEnhancement/AudioClassification/
# GStreamerPipeline via ".status-lbl", AudioOffload/2DFft/SigchainBiquad via an unlabelled
# trailing span) renders its status message as the last child of ".status-row", so this single
# selector covers all of them. TvmInference.vue is no longer reachable - its demos-array entry
# is commented out of AudioDsp.vue upstream, replaced by GStreamerPipeline.vue's "Custom Audio
# Pipeline" tab.
${SEL_STATUS_TXT}             .status-row > span:last-child
${SEL_RESULT_ROW}             .result-row
${SEL_RESULTS_GRID}           .results-grid
${SEL_FIELD_SELECT}           .field-select
${SEL_MODEL_CARD}             .model-card
${SEL_DROP_ZONE}              .drop-zone
${SEL_THEME_BTN}              .v-app-bar button:has(.mdi-weather-night), .v-app-bar button:has(.mdi-weather-sunny)
${SEL_ICON_DARK}              .mdi-weather-night
${SEL_ICON_LIGHT}             .mdi-weather-sunny
${SEL_DEVICE_INFO_DIALOG}     .sys-card
${SEL_HERO_BTN}               .hero-content .v-btn
${SEL_DEMO_ITEM}              .demo-item
${SEL_LOGS_FILTER_INPUT}      .search-input
${SEL_LOGS_FILTER_CLEAR}      .search-clear
${SEL_LOGS_LINE}              .log-line
${SEL_MI_REFRESH_BTN}         .panel-hdr button[title="Refresh"]
${SEL_MI_UPLOAD_SUBMIT_BTN}   button:has-text("Upload & Add to Inspector")
${SEL_MI_UPLOAD_STATUS_OK}    .upload-status.status-ok
${SEL_BIQUAD_APPLY_BTN}       .apply-btn
${SEL_BIQUAD_WARN_BANNER}     .warn-banner
${SEL_BIQUAD_OK_BANNER}       .overlay-ok
${SEL_OVERLAY_REM_BTN}        .rem-btn
${SEL_REBOOT_OVERLAY}         .reboot-overlay
${SEL_PRESET_CHIP}            .preset-chip
${SEL_CMD_TEXTAREA}           .cmd-textarea
${SEL_GST_LOG_LINE}           .log-body .log-line
# Corrected version of the Custom Audio Pipeline demo's built-in "Speech Enhancement" preset
# chip command - that shipped preset uses a "param2" property on the "deinterleave"/"interleave"
# tidspkernel elements which this board's currently deployed tidspkernel GStreamer plugin no
# longer exposes (confirmed via SSH: gst-launch exits(1) immediately with "erroneous pipeline:
# no property 'param2' in element 'tidspkernel'"; gst-inspect-1.0 tidspkernel shows the current
# property is "interleave-direction", 0=deinterleave/1=interleave). Confirmed working end to end
# over SSH with this correction (runs to completion, exit 0, ~24s). Type this directly into
# ${SEL_CMD_TEXTAREA} instead of clicking the preset chip.
${GST_SPEECH_ENHANCEMENT_CMD_FIXED}    gst-launch-1.0 filesrc location=/usr/share/tvm_inference/input/input_audio.wav ! wavparse ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! tidspkernel name=stft msg-type=0x1020 model-path=/usr/share/tvm_inference/artifacts/gcrn hop-size=160 fft-size=320 window-frames=401 batch-size=64 ! tidspkernel name=deinterleave msg-type=0x1040 interleave-direction=0 model-path=/usr/share/tvm_inference/artifacts/gcrn fft-size=320 window-frames=401 ! titvm model-path=/usr/share/tvm_inference/artifacts/gcrn ! tidspkernel name=interleave msg-type=0x1040 interleave-direction=1 model-path=/usr/share/tvm_inference/artifacts/gcrn fft-size=320 window-frames=401 ! tidspkernel name=istft msg-type=0x1030 model-path=/usr/share/tvm_inference/artifacts/gcrn hop-size=160 fft-size=320 window-frames=401 batch-size=64 ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! tee name=t ! queue ! wavenc ! filesink location=/tmp/gst_enhanced.wav t. ! queue ! audioconvert ! audioresample ! autoaudiosink

*** Keywords ***

OPEN WEBSERVER GUI
    [Arguments]    ${base_url}
    [Documentation]    Launches a browser against the given webserver-oob base URL and waits for
    ...    the App.vue health WebSocket to report Connected.
    ${no_proxy_env}=    Evaluate
    ...    {k: v for k, v in __import__('os').environ.items() if 'proxy' not in k.lower()}
    Browser.New Browser    ${BROWSER_TYPE}    headless=${HEADLESS}    env=${no_proxy_env}
    Browser.New Context    viewport={'width': 1440, 'height': 900}    acceptDownloads=${True}
    Browser.New Page    ${base_url}#/home
    Browser.Wait For Elements State    ${SEL_CONN_TXT}    visible    timeout=20s
    Browser.Get Text    ${SEL_CONN_TXT}    *=    Connected

CLOSE WEBSERVER GUI
    [Documentation]    Closes every browser opened by this suite. Safe to call even if no
    ...    browser is open.
    Run Keyword And Ignore Error    Browser.Close Browser    ALL

NAVIGATE TO PAGE
    [Arguments]    ${nav_title}
    [Documentation]    Clicks a sidebar nav item by its visible title, e.g. "Home",
    ...    "Audio Intelligence", "DSP Acceleration", "AI Model Inspector", "Logs", and waits for
    ...    the resulting client-side route change to actually land. router/index.js's
    ...    router.beforeEach guard is async (it always resolves near-instantly when no demo is
    ...    running, but is never truly synchronous with the click) - without this wait, a caller
    ...    that checks Browser.Get Url or page content immediately after this keyword returns can
    ...    intermittently observe the pre-navigation state (confirmed root cause of a flaky
    ...    AI Model Inspector failure that looked like a model-list-fetch timing issue but was
    ...    actually the click's own navigation never having landed yet). Waits for Vuetify's own
    ...    "v-list-item--active" class on the clicked item rather than comparing URLs before/after
    ...    - that class reflects the router's current-route match and is already correctly "true"
    ...    when navigating to the page you're already on (e.g. a defensive "NAVIGATE TO PAGE
    ...    Home" when already on Home), which a before/after URL-changed check would wrongly fail.
    Browser.Click    ${SEL_NAV_ITEM}:has-text("${nav_title}")
    Browser.Wait For Elements State
    ...    ${SEL_NAV_ITEM}.v-list-item--active:has-text("${nav_title}")    visible    timeout=3s

SELECT DEMO
    [Arguments]    ${demo_name}
    [Documentation]    Clicks a demo-selector card (the ".dsi" entries on the Audio Intelligence
    ...    / DSP Acceleration pages) by its visible name and confirms it became active. Each demo
    ...    panel is a defineAsyncComponent (DspCompute.vue/AudioDsp.vue), fetched over the network
    ...    the first time it is selected in a session - the ".dsi" tile's own "active" class flips
    ...    synchronously on click (activeIdx is a plain ref), well before that fetch completes, so
    ...    asserting only the class - as this keyword used to - lets a caller proceed while the
    ...    OLD demo's component/ref is still mounted. RUN ACTIVE DEMO would then click a run/stop
    ...    button still wired to the previous demo's instance. Waiting for network idle after the
    ...    click closes that gap (confirmed against the real board: the very first
    ...    "2D FFT Offload" selection in a session left "Audio DSP Offload" visibly active for a
    ...    couple hundred ms while its chunk downloaded). Separately, both AudioDsp.vue and
    ...    DspCompute.vue wrap the demo panel in a <Transition mode="out-in"> (demo-fade, 0.12s
    ...    leave then 0.12s enter) - the OLD component only actually unmounts, and the NEW one
    ...    only mounts (wiring up its run/stop ref), after that ~0.24s CSS transition finishes,
    ...    even once already cached (no network activity at all, so networkidle alone doesn't
    ...    cover this case - confirmed on the real board switching Audio Classification ->
    ...    Speech Enhancement, both already loaded from earlier in the same session).
    Browser.Click    ${SEL_DSI}:has-text("${demo_name}")
    Browser.Wait For Load State    state=networkidle    timeout=10s
    Sleep    300ms
    Browser.Get Attribute    ${SEL_DSI}:has-text("${demo_name}")    class    contains    active

SWITCH DEMO AND ACCEPT CONFIRM
    [Arguments]    ${demo_name}
    [Documentation]    Switches the active demo while one is running, accepting the native
    ...    window.confirm() dialog raised by AudioDsp.vue/DspCompute.vue selectDemo(), then waits
    ...    out both the demo-fade CSS transition and the real board's C7x DSP release lag (see
    ...    STOP ACTIVE DEMO) before returning, since selectDemo() stops the outgoing demo as part
    ...    of the same click that starts switching to the new one.
    Browser.Handle Future Dialogs    action=accept
    Browser.Click    ${SEL_DSI}:has-text("${demo_name}")
    Browser.Wait For Load State    state=networkidle    timeout=10s
    Sleep    4s

RUN ACTIVE DEMO
    [Documentation]    Clicks the page-header Run/Stop button to start the currently selected demo.
    ...    Waits for the button to actually be enabled first - AudioDsp.vue disables it until
    ...    tvmReady/tvmWasReady flips true, and WAIT FOR TVM READY's own banner check has been
    ...    observed on real hardware to report ready a moment before the button's own computed
    ...    prop catches up, which otherwise fails the click outright instead of just running late.
    Browser.Wait For Elements State    ${SEL_DEMO_HDR_BTN}    enabled    timeout=15s
    Browser.Click    ${SEL_DEMO_HDR_BTN}

STOP ACTIVE DEMO
    [Documentation]    Clicks the page-header Run/Stop button to stop the currently running demo,
    ...    then gives the backend a moment to actually release the shared C7x DSP resource. The
    ...    frontend flips the button back to "Run Demo" as soon as it gets a stop acknowledgement,
    ...    but the real board takes a bit longer to tear down the rpmsg/TIDL process underneath -
    ...    starting a different C7x-DSP demo (on this page or another) too soon after gets a real
    ...    "C7x DSP is busy: '<previous demo>' is already running" error from the backend
    ...    (confirmed on real hardware switching straight from Audio DSP Offload to 2D FFT
    ...    Offload, and separately from Speech Enhancement to Custom Audio Pipeline).
    Browser.Click    ${SEL_DEMO_HDR_BTN}
    Sleep    4s

GET DEMO HEADER BUTTON TEXT
    [Documentation]    Returns the current page-header Run/Stop button text, e.g. "Run Demo" /
    ...    "Preparing Demo..." / "Stop Demo".
    ${txt}=    Browser.Get Text    ${SEL_DEMO_HDR_BTN}
    RETURN    ${txt}

WAIT FOR DEMO HEADER BUTTON TEXT
    [Arguments]    ${expected_text}    ${timeout}=15s
    [Documentation]    Compares case-insensitively: Vuetify applies "text-transform: uppercase"
    ...    to v-btn by default and AudioDsp.vue is the only page that overrides it back to mixed
    ...    case (".run-btn { text-transform:none }") - DspCompute.vue's header button renders as
    ...    "RUN DEMO"/"STOP DEMO" since it has no such override, and Get Text (Playwright
    ...    innerText) reflects that rendered case.
    Wait Until Keyword Succeeds    ${timeout}    0.5s
    ...    DEMO HEADER BUTTON TEXT SHOULD BE    ${expected_text}

DEMO HEADER BUTTON TEXT SHOULD BE
    [Arguments]    ${expected_text}
    ${txt}=    Browser.Get Text    ${SEL_DEMO_HDR_BTN}
    BuiltIn.Should Be Equal As Strings    ${txt}    ${expected_text}    ignore_case=True

WAIT FOR TVM READY
    [Arguments]    ${timeout}=${TVM_READY_TIMEOUT}
    [Documentation]    Waits for the C7x/TVM readiness banner on the Audio Intelligence page
    ...    (AudioDsp.vue ".preparing-alert") to clear.
    Browser.Wait For Elements State    ${SEL_PREPARING_ALERT}    hidden    timeout=${timeout}

WAIT FOR MODEL LOADING TO CLEAR
    [Arguments]    ${timeout}=20s
    Browser.Wait For Elements State    ${SEL_MODEL_LOADING_ALERT}    hidden    timeout=${timeout}

GET DEMO STATUS TEXT
    ${txt}=    Browser.Get Text    ${SEL_STATUS_TXT}
    RETURN    ${txt}

WAIT FOR DEMO STATUS TEXT
    [Arguments]    ${expected_text}    ${timeout}=15s
    Wait Until Keyword Succeeds    ${timeout}    0.5s
    ...    DEMO STATUS TEXT SHOULD BE    ${expected_text}

DEMO STATUS TEXT SHOULD BE
    [Documentation]    Substring match, not exact equality - some demos append detail to the
    ...    base status word, e.g. Audio DSP Offload's server-plugin.js reports
    ...    "Connected to <host>" rather than a bare "Connected".
    [Arguments]    ${expected_text}
    ${txt}=    Browser.Get Text    ${SEL_STATUS_TXT}
    BuiltIn.Should Contain    ${txt}    ${expected_text}    ignore_case=True

CLONE OR UPDATE WEBSERVER OOB DEMO REPO
    [Documentation]    Clones (or fast-forwards) ${DEMO_REPO_URL}@${DEMO_REPO_BRANCH} into
    ...    ${DEMO_CLONE_DIR} so the offline suite exercises canonical upstream source rather than
    ...    whatever local working copy happens to be checked out, then installs common/webserver's
    ...    npm deps and builds the AM62D Vue frontend - both are gitignored in that repo, so a
    ...    fresh clone has neither, and devices/am62dxx/app/vue-dist is what server.js actually
    ...    serves (see frontend/vite.config.js outDir). Skipped entirely when ${DEMO_ROOT} has
    ...    been overridden to point at a local checkout instead. Rebuilds the frontend whenever
    ...    the update actually moved HEAD (or on a fresh clone), not on every run, so repeat runs
    ...    stay fast once the clone is warm.
    IF    '${DEMO_ROOT}' != '${DEMO_CLONE_DIR}'    RETURN
    ${already_cloned}=    Run Keyword And Return Status    OS.Directory Should Exist    ${DEMO_CLONE_DIR}/.git
    IF    ${already_cloned}
        ${before}=    Process.Run Process    git    rev-parse    HEAD    cwd=${DEMO_CLONE_DIR}
        ${result}=    Process.Run Process    git    fetch    --depth    1    origin    ${DEMO_REPO_BRANCH}
        ...    cwd=${DEMO_CLONE_DIR}    timeout=60s
        Should Be Equal As Integers    ${result.rc}    0    msg=git fetch failed: ${result.stderr}
        ${result}=    Process.Run Process    git    reset    --hard    origin/${DEMO_REPO_BRANCH}
        ...    cwd=${DEMO_CLONE_DIR}
        Should Be Equal As Integers    ${result.rc}    0    msg=git reset failed: ${result.stderr}
        ${after}=    Process.Run Process    git    rev-parse    HEAD    cwd=${DEMO_CLONE_DIR}
        ${changed}=    Evaluate    '${before.stdout}' != '${after.stdout}'
    ELSE
        ${result}=    Process.Run Process    git    clone    --branch    ${DEMO_REPO_BRANCH}    --depth    1
        ...    ${DEMO_REPO_URL}    ${DEMO_CLONE_DIR}    timeout=120s
        Should Be Equal As Integers    ${result.rc}    0    msg=git clone failed: ${result.stderr}
        ${changed}=    Set Variable    ${True}
    END
    ${vue_dist_missing}=    Run Keyword And Return Status
    ...    OS.File Should Not Exist    ${DEMO_CLONE_DIR}/devices/am62dxx/app/vue-dist/index.html
    IF    ${changed} or ${vue_dist_missing}
        ${result}=    Process.Run Process    npm    install    cwd=${DEMO_CLONE_DIR}/common/webserver    timeout=180s
        Should Be Equal As Integers    ${result.rc}    0    msg=npm install (webserver) failed: ${result.stderr}
        ${result}=    Process.Run Process    npm    install    cwd=${DEMO_CLONE_DIR}/frontend    timeout=180s
        Should Be Equal As Integers    ${result.rc}    0    msg=npm install (frontend) failed: ${result.stderr}
        ${result}=    Process.Run Process    npm    run    build    cwd=${DEMO_CLONE_DIR}/frontend
        ...    env:VITE_DEVICE=am62dxx    timeout=180s
        Should Be Equal As Integers    ${result.rc}    0    msg=frontend build failed: ${result.stderr}
    END

MERGE DEVICE MODEL INSPECTOR FILES INTO COMMON APP
    [Documentation]    "make dev"/"dev-mock" (which START WEBSERVER OOB DEMO OFFLINE mirrors) runs
    ...    server.js with argv[2]=common/app, and only that directory - never the
    ...    devices/am62dxx/app device overlay that Express statically serves alongside it - is what
    ...    the /model-inspector-list and /upload-model-file routes in
    ...    devices/am62dxx/server-plugin.js actually read/write (both hardcode the appDir they were
    ...    started with). The built-in GCRN.html model card therefore ships only under
    ...    devices/am62dxx/app/Model-Inspector/ and is invisible to ModelInspector.vue's
    ...    loadModelList() under the dev-mock flow, even though it's fully visible after a real
    ...    "make deploy", whose deploy-app target tars both common/app and devices/$(DEVICE)/app
    ...    into the same merged directory on the board. Copying the device Model-Inspector folder
    ...    into common/app/Model-Inspector before every offline run reproduces that same merged
    ...    layout locally, so this suite exercises the AI Model Inspector the way it actually
    ...    behaves once deployed rather than an artifact of the local dev/dev-mock script only.
    ${device_mi_dir}=    Set Variable    ${DEMO_ROOT}/devices/am62dxx/app/Model-Inspector
    ${common_mi_dir}=    Set Variable    ${DEMO_ROOT}/common/app/Model-Inspector
    ${exists}=    Run Keyword And Return Status    OS.Directory Should Exist    ${device_mi_dir}
    IF    ${exists}
        OS.Create Directory    ${common_mi_dir}
        OS.Copy Files    ${device_mi_dir}${/}*.html    ${common_mi_dir}
    END

START WEBSERVER OOB DEMO OFFLINE
    [Documentation]    Clones/updates the upstream webserver-oob-demo repo (unless ${DEMO_ROOT}
    ...    was overridden to a local checkout), then starts common/webserver/server.js against
    ...    the am62dxx device config with MOCK=1 (mirrors "make dev-mock DEVICE=am62dxx" in
    ...    ${DEMO_ROOT}/Makefile), then opens the GUI against it once it is accepting connections.
    CLONE OR UPDATE WEBSERVER OOB DEMO REPO
    MERGE DEVICE MODEL INSPECTOR FILES INTO COMMON APP
    FREE WEBSERVER PORT
    Process.Start Process    node    common/webserver/server.js    ${DEMO_ROOT}/common/app
    ...    cwd=${DEMO_ROOT}
    ...    env:DEVICE_CONFIG=${DEMO_ROOT}/devices/am62dxx/device.json
    ...    env:MOCK=1
    ...    env:PORT=${WEBSERVER_PORT}
    ...    alias=webserver_offline
    ...    stdout=${OUTPUT_DIR}/webserver_offline_stdout.log
    ...    stderr=STDOUT
    Wait Until Keyword Succeeds    15x    2s    OPEN WEBSERVER GUI    http://localhost:${WEBSERVER_PORT}/

FREE WEBSERVER PORT
    [Documentation]    Kills any process already bound to ${WEBSERVER_PORT} before starting a
    ...    fresh offline server. Guards against a leftover node server.js from a previous run
    ...    whose Suite Teardown never executed (e.g. the run was killed/interrupted rather than
    ...    completing normally) - observed to silently monopolise the port so a new
    ...    Process.Start Process here exits immediately on EADDRINUSE while
    ...    Wait Until Keyword Succeeds/OPEN WEBSERVER GUI still "passes" against that stale,
    ...    possibly out-of-date server instead of the one this run just tried to start.
    Process.Run Process    bash    -c    fuser -k ${WEBSERVER_PORT}/tcp || true
    Sleep    1s

STOP WEBSERVER OOB DEMO OFFLINE
    [Documentation]    Closes the browser then terminates the offline server.js process started
    ...    by START WEBSERVER OOB DEMO OFFLINE.
    CLOSE WEBSERVER GUI
    Run Keyword And Ignore Error    Process.Terminate Process    webserver_offline
    Run Keyword And Ignore Error    Process.Wait For Process    webserver_offline    timeout=10s    on_timeout=kill

TOGGLE THEME
    [Documentation]    Clicks the app-bar dark/light theme toggle and returns which theme is
    ...    active afterwards ("light" or "dark"), inferred from which weather icon is now
    ...    showing (App.vue swaps mdi-weather-night/mdi-weather-sunny on toggleTheme()).
    Browser.Click    ${SEL_THEME_BTN}
    ${light_count}=    Browser.Get Element Count    ${SEL_ICON_LIGHT}
    IF    ${light_count} > 0
        RETURN    light
    ELSE
        RETURN    dark
    END

OPEN DEVICE INFO DIALOG
    [Documentation]    Clicks the "Device Info" sidebar item (App.vue openDeviceInfo()) and waits
    ...    for the resulting dialog.
    Browser.Click    ${SEL_NAV_ITEM}:has-text("Device Info")
    Browser.Wait For Elements State    ${SEL_DEVICE_INFO_DIALOG}    visible    timeout=10s

CLOSE DEVICE INFO DIALOG
    Browser.Click    ${SEL_DEVICE_INFO_DIALOG} button:has(.mdi-close)
    Browser.Wait For Elements State    ${SEL_DEVICE_INFO_DIALOG}    hidden    timeout=5s

CLICK HOME HERO BUTTON
    [Documentation]    Clicks the Home page hero CTA (Home.vue heroButton, device-specific
    ...    label/target).
    Browser.Click    ${SEL_HERO_BTN}

CLICK DEMO CARD BY INDEX
    [Documentation]    Clicks the Nth "Explore Demos And Tools" card on the Home page
    ...    (Home.vue demoCards, 0-indexed).
    [Arguments]    ${index}=0
    Browser.Click    ${SEL_DEMO_ITEM} >> nth=${index}

SET LOGS FILTER
    [Arguments]    ${text}
    Browser.Fill Text    ${SEL_LOGS_FILTER_INPUT}    ${text}

CLEAR LOGS FILTER
    Browser.Click    ${SEL_LOGS_FILTER_CLEAR}

TOGGLE LOGS AUTO REFRESH
    [Documentation]    Clicks the Logs page Pause/Resume button (Logs.vue autoRefresh toggle).
    Browser.Click    .ph-actions button:has-text("Pause"), .ph-actions button:has-text("Resume")

CLICK LOGS REFRESH
    Browser.Click    .ph-actions button:has-text("Refresh")

SAVE LOGS TO FILE AND WAIT
    [Documentation]    Clicks "Save to File" (Logs.vue saveToFile(), a client-side Blob download)
    ...    and waits for the resulting download, returning the Browser library DownloadInfo dict.
    ${promise}=    Browser.Promise To Wait For Download
    Browser.Click    .ph-actions button:has-text("Save to File")
    ${download}=    Browser.Wait For    ${promise}
    RETURN    ${download}

CLICK MODEL INSPECTOR REFRESH
    Browser.Click    ${SEL_MI_REFRESH_BTN}

UPLOAD MODEL FILE
    [Documentation]    Runs the full AI Model Inspector upload flow (ModelInspector.vue): opens
    ...    the upload dialog, sets the given file on the hidden file input directly (bypassing
    ...    click/drag-drop, which Playwright can't drive for native OS file pickers), fills
    ...    Model Name/Task Type/Quantization, submits, and waits for the "Uploaded successfully!"
    ...    status. Posts to /upload-model-file, which writes into the Model-Inspector folder on
    ...    whatever host is serving the GUI (local checkout offline, the board's rootfs on EVM) -
    ...    callers on the EVM suite are responsible for cleaning up if that matters for the lab.
    [Arguments]    ${file_path}    ${model_name}    ${task_type}=Image Classification    ${quant}=INT8
    Browser.Click    button:has-text("Upload")
    Browser.Wait For Elements State    ${SEL_DROP_ZONE}    visible
    Browser.Upload File By Selector    input[type="file"]    ${file_path}
    Browser.Fill Text    input[placeholder="e.g. MobileNet v2"]    ${model_name}
    Browser.Select Options By    select.field-select >> nth=0    label    ${task_type}
    Browser.Select Options By    select.field-select >> nth=1    label    ${quant}
    Browser.Click    ${SEL_MI_UPLOAD_SUBMIT_BTN}
    Browser.Wait For Elements State    ${SEL_MI_UPLOAD_STATUS_OK}    visible    timeout=10s
