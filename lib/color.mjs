/** Color math: frame → per-zone color → Matter hue/saturation/level targets. */

export const srgbToLin = new Float32Array(256).map((_, i) => {
    const c = i / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const linToSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * Analyze an RGBA frame. For each zone returns {r,g,b} (0..1, sRGB) and brightness (0..1).
 * Saturated, bright pixels are weighted more than grey ones — otherwise every scene averages to beige.
 */
export function analyze(raw, width, height, rects) {
    const step = Math.max(1, Math.floor(width / 192)); // ~192 samples across
    return rects.map(z => {
        const x0 = Math.floor(z.x * width), x1 = Math.min(width, Math.ceil((z.x + z.w) * width));
        const y0 = Math.floor(z.y * height), y1 = Math.min(height, Math.ceil((z.y + z.h) * height));
        let wr = 0, wg = 0, wb = 0, wsum = 0, vsum = 0, n = 0;
        for (let y = y0; y < y1; y += step) {
            let i = (y * width + x0) * 4;
            for (let x = x0; x < x1; x += step, i += step * 4) {
                const R = raw[i], G = raw[i + 1], B = raw[i + 2];
                const max = Math.max(R, G, B), min = Math.min(R, G, B);
                const v = max / 255;
                vsum += v;
                n++;
                if (max < 10) continue; // letterbox bars and dark noise don't affect the hue
                const s = (max - min) / max;
                const w = v * (0.08 + s * s * 3);
                wr += srgbToLin[R] * w;
                wg += srgbToLin[G] * w;
                wb += srgbToLin[B] * w;
                wsum += w;
            }
        }
        const brightness = n ? vsum / n : 0;
        if (!wsum) return { r: 0, g: 0, b: 0, brightness };
        return { r: linToSrgb(wr / wsum), g: linToSrgb(wg / wsum), b: linToSrgb(wb / wsum), brightness };
    });
}

export function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
}

/** sRGB → CIE xy (for lamps without hue/saturation support). */
export function rgbToXy(r, g, b) {
    const R = srgbToLin[Math.round(r * 255)], G = srgbToLin[Math.round(g * 255)], B = srgbToLin[Math.round(b * 255)];
    const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
    const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
    const sum = X + Y + Z;
    if (!sum) return { x: 0.3127, y: 0.329 };
    return { x: X / sum, y: Y / sum };
}

/** Matter hue (0..254) → CIE xy at full saturation. */
export function hueToXy(hue254) {
    const h = (hue254 / 254) * 360;
    const f = n => {
        const k = (n + h / 60) % 6;
        return 1 - Math.max(0, Math.min(k, 4 - k, 1));
    };
    return rgbToXy(f(5), f(3), f(1));
}

/** Zone color + settings → lamp target in Matter units. */
export function toLampTarget(c, cfg) {
    const hsv = rgbToHsv(c.r, c.g, c.b);
    const sat = Math.min(1, hsv.s * cfg.saturationBoost);
    const bri = Math.min(1, c.brightness * 1.6) ** cfg.brightnessGamma; // an average movie frame is ~0.2–0.4
    const pct = cfg.minBrightness + (cfg.maxBrightness - cfg.minBrightness) * bri;
    // rebuild RGB with the boosted saturation for the xy path
    const cc = sat, x = cc * (1 - Math.abs(((hsv.h / 60) % 2) - 1)), m = 1 - cc;
    const [r1, g1, b1] = [[cc, x, 0], [x, cc, 0], [0, cc, x], [0, x, cc], [x, 0, cc], [cc, 0, x]][Math.floor(hsv.h / 60) % 6];
    return {
        hue: Math.round((hsv.h / 360) * 254),
        sat: Math.round(sat * 254),
        level: Math.max(1, Math.min(254, Math.round((pct / 100) * 254))),
        xy: rgbToXy(r1 + m, g1 + m, b1 + m),
    };
}

/** True-color block for terminal output. */
export const swatch = c => {
    const to = v => Math.round(Math.max(0, Math.min(1, v)) * 255);
    return `\x1b[48;2;${to(c.r)};${to(c.g)};${to(c.b)}m      \x1b[0m`;
};
