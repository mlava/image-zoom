let hashChange = undefined;
let observer = null;

// Track which images we've processed (WeakSet avoids retaining DOM nodes)
let processedImgs = new WeakSet();

// Strong set for teardown/rebuild so we only destroy OUR images
let processedImgsStrong = new Set();

let scheduledScan = null;

// -------------------- SETTINGS --------------------

const SETTING_ZOOM_STEP = "zoom_step";
const DEFAULT_ZOOM_STEP = 0.1;

const SETTING_MAX_ZOOM = "max_zoom";
const DEFAULT_MAX_ZOOM = 0; // 0 = unlimited

const SETTING_REQUIRE_MODIFIER = "require_modifier";
const DEFAULT_REQUIRE_MODIFIER = true;

const SETTING_MODIFIER_KEY = "modifier_key";
const DEFAULT_MODIFIER_KEY = "Alt"; // Alt | Ctrl | Shift | Meta

const SETTING_MIN_IMAGE_WIDTH = "min_image_width";
const DEFAULT_MIN_IMAGE_WIDTH = 80;

const SETTING_MIN_IMAGE_HEIGHT = "min_image_height";
const DEFAULT_MIN_IMAGE_HEIGHT = 80;

// -------------------- HELPERS --------------------

function normalizeBoolean(v, fallback = false) {
    if (v === true || v === "true" || v === 1 || v === "1") return true;
    if (v === false || v === "false" || v === 0 || v === "0") return false;
    return fallback;
}

function normalizeNumber(v, fallback) {
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function getSettings(extensionAPI) {
    const zoomStep = normalizeNumber(
        extensionAPI?.settings?.get?.(SETTING_ZOOM_STEP),
        DEFAULT_ZOOM_STEP
    );

    const maxZoomRaw = normalizeNumber(
        extensionAPI?.settings?.get?.(SETTING_MAX_ZOOM),
        DEFAULT_MAX_ZOOM
    );
    // Values <= 1 effectively disable zooming (you can never exceed the base size),
    // so treat them as "unlimited" to avoid a confusing "nothing happens" outcome.
    const maxZoom = maxZoomRaw > 1 ? maxZoomRaw : false;

    const requireModifier = normalizeBoolean(
        extensionAPI?.settings?.get?.(SETTING_REQUIRE_MODIFIER),
        DEFAULT_REQUIRE_MODIFIER
    );

    let modifierKey =
        (extensionAPI?.settings?.get?.(SETTING_MODIFIER_KEY) || DEFAULT_MODIFIER_KEY) + "";

    const minW = Math.max(
        0,
        normalizeNumber(
            extensionAPI?.settings?.get?.(SETTING_MIN_IMAGE_WIDTH),
            DEFAULT_MIN_IMAGE_WIDTH
        )
    );

    const minH = Math.max(
        0,
        normalizeNumber(
            extensionAPI?.settings?.get?.(SETTING_MIN_IMAGE_HEIGHT),
            DEFAULT_MIN_IMAGE_HEIGHT
        )
    );

    // Clamp zoomStep to something sane
    const zoom = Math.min(0.5, Math.max(0.01, zoomStep));

    return {
        zoom,
        maxZoom,
        requireModifier,
        modifierKey,
        minW,
        minH,
    };
}

function modifierPressed(e, modifierKey) {
    const key = (modifierKey || "Alt").toLowerCase();
    if (key === "alt") return !!e.altKey;
    if (key === "ctrl") return !!e.ctrlKey;
    if (key === "shift") return !!e.shiftKey;
    if (key === "meta") return !!e.metaKey;
    // Fallback: require alt
    return !!e.altKey;
}

function isRoamUiImage(img) {
    // Exclude obvious UI containers
    const uiSelectors = [
        ".rm-topbar",
        ".rm-topbar__",
        "#rm-topbar",
        ".rm-sidebar",
        "#right-sidebar",
        ".bp3-popover",
        ".bp3-menu",
        ".bp3-dialog",
        ".bp3-overlay",
        ".bp3-portal",
        ".rm-quick-capture",
    ];
    for (const sel of uiSelectors) {
        try {
            if (img.closest(sel)) return true;
        } catch {
            // ignore selector issues
        }
    }
    return false;
}

function isEligibleImage(img, settings) {
    if (!img || !img.nodeName || img.nodeName !== "IMG") return false;
    if (processedImgs.has(img)) return false;

    // Exclude UI images
    if (isRoamUiImage(img)) return false;

    // Exclude very small images (icons)
    const natW = img.naturalWidth || 0;
    const natH = img.naturalHeight || 0;

    const rect = img.getBoundingClientRect?.();
    const renderW = rect?.width || 0;
    const renderH = rect?.height || 0;

    const w = natW || renderW;
    const h = natH || renderH;

    if (w && w < settings.minW) return false;
    if (h && h < settings.minH) return false;

    // Exclude empty/broken images
    if (!img.src) return false;

    return true;
}

function scheduleScan(fn, delayMs = 150) {
    if (scheduledScan) window.clearTimeout(scheduledScan);
    scheduledScan = window.setTimeout(() => {
        scheduledScan = null;
        fn();
    }, delayMs);
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------- EXTENSION --------------------

export default {
    onload: ({ extensionAPI }) => {
        extensionAPI?.settings?.panel?.create?.({
            tabTitle: "Image Zoom",
            settings: [
                {
                    id: SETTING_ZOOM_STEP,
                    name: "Zoom step",
                    description: "How much each wheel notch zooms (0.01–0.50). Default 0.10.",
                    action: {
                        type: "input",
                        placeholder: String(DEFAULT_ZOOM_STEP),
                        onChange: (value) => {
                            const raw = value?.target?.value ?? value;
                            if (raw === "") {
                                extensionAPI?.settings?.set?.(SETTING_ZOOM_STEP, raw);
                                scheduleRebuild();
                                return;
                            }

                            const parsed = normalizeNumber(raw, null);
                            if (parsed === null) return;

                            extensionAPI?.settings?.set?.(
                                SETTING_ZOOM_STEP,
                                Math.min(0.5, Math.max(0.01, parsed))
                            );
                            scheduleRebuild();
                        },
                    },
                },
                {
                    id: SETTING_MAX_ZOOM,
                    name: "Max zoom",
                    description: "Maximum zoom multiplier (> 1, e.g. 4). Use 0 for unlimited. Default 0.",
                    action: {
                        type: "input",
                        placeholder: String(DEFAULT_MAX_ZOOM),
                        onChange: (value) => {
                            const raw = value?.target?.value ?? value;
                            if (raw === "") {
                                extensionAPI?.settings?.set?.(SETTING_MAX_ZOOM, raw);
                                scheduleRebuild();
                                return;
                            }

                            const parsed = normalizeNumber(raw, null);
                            if (parsed === null) return;

                            extensionAPI?.settings?.set?.(SETTING_MAX_ZOOM, Math.max(0, parsed));
                            scheduleRebuild();
                        },
                    },
                },
                {
                    id: SETTING_REQUIRE_MODIFIER,
                    name: "Require modifier key",
                    description:
                        "If enabled, zoom only triggers when a modifier key is held (prevents scroll hijacking).",
                    action: {
                        type: "switch",
                        onChange: (value) => {
                            const next = value?.target?.checked ?? value?.checked ?? value;
                            extensionAPI?.settings?.set?.(
                                SETTING_REQUIRE_MODIFIER,
                                normalizeBoolean(next, DEFAULT_REQUIRE_MODIFIER)
                            );
                            scheduleRebuild();
                        },
                    },
                },
                {
                    id: SETTING_MODIFIER_KEY,
                    name: "Modifier key",
                    description: "Which key must be held to zoom (Alt, Ctrl, Shift, Meta).",
                    action: {
                        type: "select",
                        items: ["Alt", "Ctrl", "Shift", "Meta"],
                        onChange: (value) => {
                            const next = value?.target?.value ?? value;
                            extensionAPI?.settings?.set?.(SETTING_MODIFIER_KEY, next);
                            scheduleRebuild();
                        },
                    },
                },
                {
                    id: SETTING_MIN_IMAGE_WIDTH,
                    name: "Min image width (px)",
                    description: "Skip very small images (icons). Applies to natural or rendered width.",
                    action: {
                        type: "input",
                        placeholder: String(DEFAULT_MIN_IMAGE_WIDTH),
                        onChange: (value) => {
                            const raw = value?.target?.value ?? value;
                            if (raw === "") {
                                extensionAPI?.settings?.set?.(SETTING_MIN_IMAGE_WIDTH, raw);
                                scheduleRebuild();
                                return;
                            }

                            const parsed = normalizeNumber(raw, null);
                            if (parsed === null) return;

                            extensionAPI?.settings?.set?.(SETTING_MIN_IMAGE_WIDTH, Math.max(0, parsed));
                            scheduleRebuild();
                        },
                    },
                },
                {
                    id: SETTING_MIN_IMAGE_HEIGHT,
                    name: "Min image height (px)",
                    description: "Skip very small images (icons). Applies to natural or rendered height.",
                    action: {
                        type: "input",
                        placeholder: String(DEFAULT_MIN_IMAGE_HEIGHT),
                        onChange: (value) => {
                            const raw = value?.target?.value ?? value;
                            if (raw === "") {
                                extensionAPI?.settings?.set?.(SETTING_MIN_IMAGE_HEIGHT, raw);
                                scheduleRebuild();
                                return;
                            }

                            const parsed = normalizeNumber(raw, null);
                            if (parsed === null) return;

                            extensionAPI?.settings?.set?.(SETTING_MIN_IMAGE_HEIGHT, Math.max(0, parsed));
                            scheduleRebuild();
                        },
                    },
                },
            ],
        });

        /*!
          Wheelzoom 4.0.1
          license: MIT
          http://www.jacklmoore.com/wheelzoom
        */
        let wheelzoom = (function () {
            var defaults = {
                zoom: 0.1,
                maxZoom: false,
                initialZoom: 1,
                initialX: 0.5,
                initialY: 0.5,

                // Extension additions:
                requireModifier: false,
                modifierKey: "Alt",
            };

            var main = function (img, options) {
                if (!img || !img.nodeName || img.nodeName !== "IMG") return;

                // ---- Extension tweak: persist original src once ----
                // Ensures destroy always restores the real image URL (not the transparent filler)
                try {
                    if (!img.dataset.wheelzoomOriginalSrc) {
                        img.dataset.wheelzoomOriginalSrc = img.src || "";
                    }
                } catch {
                    // ignore dataset issues
                }

                var settings = {};
                var width;
                var height;
                var bgWidth;
                var bgHeight;
                var bgPosX;
                var bgPosY;
                var previousEvent;
                var transparentSpaceFiller;
                var suppressNextClick = false;
                var suppressUntil = 0;

                function setSrcToBackground(img) {
                    img.style.backgroundRepeat = "no-repeat";
                    img.style.backgroundImage = 'url("' + img.src + '")';
                    transparentSpaceFiller =
                        "data:image/svg+xml;base64," +
                        window.btoa(
                            '<svg xmlns="http://www.w3.org/2000/svg" width="' +
                            img.naturalWidth +
                            '" height="' +
                            img.naturalHeight +
                            '"></svg>'
                        );
                    img.src = transparentSpaceFiller;
                }

                function updateBgStyle() {
                    if (bgPosX > 0) {
                        bgPosX = 0;
                    } else if (bgPosX < width - bgWidth) {
                        bgPosX = width - bgWidth;
                    }

                    if (bgPosY > 0) {
                        bgPosY = 0;
                    } else if (bgPosY < height - bgHeight) {
                        bgPosY = height - bgHeight;
                    }

                    img.style.backgroundSize = bgWidth + "px " + bgHeight + "px";
                    img.style.backgroundPosition = bgPosX + "px " + bgPosY + "px";
                }

                function reset() {
                    bgWidth = width;
                    bgHeight = height;
                    bgPosX = bgPosY = 0;
                    updateBgStyle();
                }

                function swallowClickCapture(e) {
                    // Only swallow clicks immediately following our modifier interactions
                    if (!suppressNextClick) return;
                    if (Date.now() > suppressUntil) {
                        suppressNextClick = false;
                        return;
                    }

                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                    e.stopPropagation();
                    e.preventDefault();

                    // One-shot
                    suppressNextClick = false;
                }

                function onDblClickCapture(e) {
                    if (!(bgWidth > width || bgHeight > height)) return;

                    reset();

                    e.preventDefault();
                    e.stopPropagation();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

                    suppressNextClick = true;
                    suppressUntil = Date.now() + 600;
                }

                function onwheel(e) {
                    // Modifier-key gating to prevent scroll hijacking
                    if (settings.requireModifier && !modifierPressed(e, settings.modifierKey)) {
                        return;
                    }

                    var deltaY = 0;

                    e.preventDefault();
                    e.stopPropagation();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

                    if (e.deltaY) {
                        deltaY = e.deltaY;
                    } else if (e.wheelDelta) {
                        deltaY = -e.wheelDelta;
                    }

                    var rect = img.getBoundingClientRect();
                    var offsetX = e.pageX - rect.left - window.pageXOffset;
                    var offsetY = e.pageY - rect.top - window.pageYOffset;

                    var bgCursorX = offsetX - bgPosX;
                    var bgCursorY = offsetY - bgPosY;

                    var bgRatioX = bgCursorX / bgWidth;
                    var bgRatioY = bgCursorY / bgHeight;

                    if (deltaY < 0) {
                        bgWidth += bgWidth * settings.zoom;
                        bgHeight += bgHeight * settings.zoom;
                    } else {
                        bgWidth -= bgWidth * settings.zoom;
                        bgHeight -= bgHeight * settings.zoom;
                    }

                    if (settings.maxZoom) {
                        bgWidth = Math.min(width * settings.maxZoom, bgWidth);
                        bgHeight = Math.min(height * settings.maxZoom, bgHeight);
                    }

                    bgPosX = offsetX - bgWidth * bgRatioX;
                    bgPosY = offsetY - bgHeight * bgRatioY;

                    if (bgWidth <= width || bgHeight <= height) {
                        reset();
                    } else {
                        updateBgStyle();
                    }
                }

                function drag(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

                    bgPosX += e.pageX - previousEvent.pageX;
                    bgPosY += e.pageY - previousEvent.pageY;
                    previousEvent = e;
                    updateBgStyle();
                }

                function removeDrag() {
                    document.removeEventListener("mouseup", removeDrag);
                    document.removeEventListener("mousemove", drag);
                }

                function draggable(e) {
                    const isModifier =
                        !settings.requireModifier || modifierPressed(e, settings.modifierKey);

                    // Only start pan when modifier is satisfied AND image is actually zoomed
                    if (settings.requireModifier && !isModifier) return;
                    if (bgWidth <= width && bgHeight <= height) return;

                    suppressNextClick = true;
                    suppressUntil = Date.now() + 600;

                    e.preventDefault();
                    e.stopPropagation();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

                    previousEvent = e;
                    document.addEventListener("mousemove", drag);
                    document.addEventListener("mouseup", removeDrag);
                }

                function load() {
                    var initial = Math.max(settings.initialZoom, 1);

                    if (img.src === transparentSpaceFiller) return;

                    var computedStyle = window.getComputedStyle(img, null);

                    width = parseInt(computedStyle.width, 10);
                    height = parseInt(computedStyle.height, 10);
                    bgWidth = width * initial;
                    bgHeight = height * initial;
                    bgPosX = -(bgWidth - width) * settings.initialX;
                    bgPosY = -(bgHeight - height) * settings.initialY;

                    setSrcToBackground(img);

                    img.style.backgroundSize = bgWidth + "px " + bgHeight + "px";
                    img.style.backgroundPosition = bgPosX + "px " + bgPosY + "px";
                    img.addEventListener("wheelzoom.reset", reset);

                    img.addEventListener("wheel", onwheel, { passive: false });
                    img.addEventListener("mousedown", draggable);
                    img.addEventListener("click", swallowClickCapture, true);
                    img.addEventListener("dblclick", onDblClickCapture, true);
                }

                var destroy = function (originalProperties) {
                    // Ensure any in-progress drag listeners are removed from document
                    try {
                        removeDrag();
                    } catch {
                        /* ignore */
                    }

                    img.removeEventListener("wheelzoom.destroy", destroy);
                    img.removeEventListener("wheelzoom.reset", reset);
                    img.removeEventListener("load", load);
                    img.removeEventListener("mousedown", draggable);
                    img.removeEventListener("wheel", onwheel);
                    img.removeEventListener("click", swallowClickCapture, true);
                    img.removeEventListener("dblclick", onDblClickCapture, true);

                    img.style.backgroundImage = originalProperties.backgroundImage;
                    img.style.backgroundRepeat = originalProperties.backgroundRepeat;

                    // ---- Extension tweak: restore real original src (dataset) ----
                    let restoreSrc = originalProperties.src;
                    try {
                        if (img.dataset && img.dataset.wheelzoomOriginalSrc) {
                            restoreSrc = img.dataset.wheelzoomOriginalSrc || restoreSrc;
                            delete img.dataset.wheelzoomOriginalSrc;
                        }
                    } catch {
                        // ignore dataset issues
                    }
                    img.src = restoreSrc;
                }.bind(null, {
                    backgroundImage: img.style.backgroundImage,
                    backgroundRepeat: img.style.backgroundRepeat,
                    src: img.src,
                });

                img.addEventListener("wheelzoom.destroy", destroy);

                options = options || {};

                Object.keys(defaults).forEach(function (key) {
                    settings[key] = options[key] !== undefined ? options[key] : defaults[key];
                });

                if (img.complete) load();
                img.addEventListener("load", load);
            };

            if (typeof window.btoa !== "function") {
                return function (elements) {
                    return elements;
                };
            } else {
                return function (elements, options) {
                    if (elements && elements.length) {
                        Array.prototype.forEach.call(elements, function (node) {
                            main(node, options);
                        });
                    } else if (elements && elements.nodeName) {
                        main(elements, options);
                    }
                    return elements;
                };
            }
        })();

        // ---- Extension tweak: destroy only images we processed ----
        function destroyAllProcessed() {
            // copy to array to avoid mutation during iteration
            const imgs = Array.from(processedImgsStrong);
            imgs.forEach((img) => {
                try {
                    img.dispatchEvent(new Event("wheelzoom.destroy"));
                } catch {
                    // ignore
                }
            });

            processedImgs = new WeakSet();
            processedImgsStrong.clear();
        }

        function applyWheelzoomToEligibleImages() {
            const settings = getSettings(extensionAPI);

            const imgs = document.querySelectorAll("img");
            const options = {
                zoom: settings.zoom,
                maxZoom: settings.maxZoom,
                requireModifier: settings.requireModifier,
                modifierKey: settings.modifierKey,
            };

            imgs.forEach((img) => {
                if (!isEligibleImage(img, settings)) return;

                processedImgs.add(img);
                processedImgsStrong.add(img);

                try {
                    wheelzoom(img, options);
                } catch {
                    // ignore per-image failures
                }
            });
        }

        function scheduleRebuild() {
            // Wheelzoom copies options at init time, so rebuild to pick up new settings.
            scheduleScan(() => {
                destroyAllProcessed();
                applyWheelzoomToEligibleImages();
            }, 75);
        }

        function scanNowDebounced() {
            scheduleScan(applyWheelzoomToEligibleImages, 150);
        }

        hashChange = () => {
            scheduleScan(applyWheelzoomToEligibleImages, 250);
        };
        window.addEventListener("hashchange", hashChange);

        const startObserver = () => {
            const target =
                document.querySelector(".roam-body") ||
                document.querySelector(".roam-app") ||
                document.body;

            observer = new MutationObserver((mutations) => {
                let shouldScan = false;

                for (const m of mutations) {
                    if (m.type === "childList") {
                        for (const node of m.addedNodes) {
                            if (!node) continue;
                            if (node.nodeType === 1) {
                                if (node.nodeName === "IMG") {
                                    shouldScan = true;
                                    break;
                                }
                                if (node.querySelector && node.querySelector("img")) {
                                    shouldScan = true;
                                    break;
                                }
                            }
                        }
                    } else if (m.type === "attributes") {
                        if (m.target && m.target.nodeName === "IMG" && m.attributeName === "src") {
                            // src changed → wheelzoom needs a fresh init for this image
                            try {
                                m.target.dispatchEvent(new Event("wheelzoom.destroy"));
                            } catch {
                                // ignore
                            }
                            try {
                                processedImgs.delete(m.target);
                            } catch {
                                // ignore
                            }
                            try {
                                processedImgsStrong.delete(m.target);
                            } catch {
                                // ignore
                            }
                            shouldScan = true;
                        }
                    }
                    if (shouldScan) break;
                }

                if (shouldScan) scanNowDebounced();
            });

            try {
                observer.observe(target, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ["src"],
                });
            } catch {
                // noop
            }
        };

        startObserver();

        (async () => {
            await sleep(300);
            applyWheelzoomToEligibleImages();
        })();

        // Light scan shortly after load.
        scheduleScan(() => {
            applyWheelzoomToEligibleImages();
        }, 800);
    },

    onunload: () => {
        try {
            window.removeEventListener("hashchange", hashChange);
        } catch {
            // ignore
        }

        if (observer) {
            try {
                observer.disconnect();
            } catch {
                // ignore
            }
            observer = null;
        }

        if (scheduledScan) {
            try {
                window.clearTimeout(scheduledScan);
            } catch {
                // ignore
            }
            scheduledScan = null;
        }

        // Destroy only those we processed
        try {
            const imgs = Array.from(processedImgsStrong);
            imgs.forEach((img) => {
                try {
                    img.dispatchEvent(new Event("wheelzoom.destroy"));
                } catch {
                    // ignore
                }
            });
        } catch {
            // ignore
        } finally {
            processedImgs = new WeakSet();
            processedImgsStrong.clear();
        }
    },
};
