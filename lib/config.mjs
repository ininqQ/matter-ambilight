import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "./i18n.mjs";
import { GLOW_DEFAULTS } from "./glow.mjs";

/** Project root (one level above lib/). Config and Matter storage live here. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_PATH = path.join(ROOT, "config.json");
export const STORAGE_PATH = path.join(ROOT, ".matter-storage");

export const DEFAULT_CONFIG = {
    language: "auto", // "auto" | "en" | "ru"
    monitor: "primary", // "primary", an index (0, 1, …) or part of the monitor name
    fps: 20, // screen analysis rate
    maxUpdatesPerSecond: 10, // cap per lamp; real rate is limited by how fast the lamp acknowledges
    transition: 0.1, // fade inside the lamp, seconds
    smoothing: 0.15, // 0 = instant, 0.9 = very smooth
    saturationBoost: 1.5, // screen colors are usually pale; boost them for the room
    minBrightness: 3, // % in dark scenes
    maxBrightness: 100, // % in bright scenes
    brightnessGamma: 0.7, // < 1 makes mid-bright scenes brighter
    networkInterface: null, // mDNS interface name (e.g. "Ethernet"); null = all
    preferIpv4: true, // try IPv4 before IPv6 (see README: VPN clients often block IPv6)
    capture: "auto", // "auto" (ffmpeg if available) | "screenshots"
    lamps: [], // { nodeId, name, zone, endpoint }
    glow: { ...GLOW_DEFAULTS },
};

export function loadConfig() {
    let cfg = {};
    if (fs.existsSync(CONFIG_PATH)) cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return { ...DEFAULT_CONFIG, ...cfg, glow: { ...GLOW_DEFAULTS, ...(cfg.glow ?? {}) } };
}

export function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 4) + "\n");
}

/** Screen zones as fractions of width/height. */
export const ZONES = {
    all: { x: 0, y: 0, w: 1, h: 1 },
    left: { x: 0, y: 0, w: 0.33, h: 1 },
    center: { x: 0.25, y: 0, w: 0.5, h: 1 },
    right: { x: 0.67, y: 0, w: 0.33, h: 1 },
    top: { x: 0, y: 0, w: 1, h: 0.33 },
    bottom: { x: 0, y: 0.67, w: 1, h: 0.33 },
};

/** Order used by the setup wizard menu (1–6). */
export const ZONE_MENU = ["left", "right", "center", "all", "top", "bottom"];

/** Default zone suggestion for the n-th lamp. */
export const DEFAULT_ZONES = ["left", "right", "center"];

export function zoneRect(zone) {
    if (typeof zone === "object" && zone) return zone;
    const z = ZONES[zone];
    if (!z) throw new Error(t("unknownZone", zone, Object.keys(ZONES).join(", ")));
    return z;
}
