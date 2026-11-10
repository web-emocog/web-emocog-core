// Original artificial eye renderer for unit/functional tests. Not a face
// recording, trained asset, biological eye model or webcam accuracy oracle.
export function syntheticEyeImage(landmarks, { gazeX = 0, gazeY = 0, width = 640, height = 480,
    brightness = 0, contrast = 1, lidShift = 0, aperture = .23, irisVisible = true,
    glare = 0, texture = 0, texturePhase = 0, irisProfile = 'gaussian', rowIllumination = 0,
    apertureWidth = .5, apertureSlope = 0 } = {}) {
    const data = new Uint8ClampedArray(width * height * 4); data.fill(110);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    for (const [aId, bId] of [[362, 263], [133, 33]]) {
        const a = landmarks[aId], b = landmarks[bId];
        const cx = (a.x + b.x) * width / 2, cy = (a.y + b.y) * height / 2;
        let ux = (b.x - a.x) * width, uy = (b.y - a.y) * height;
        const size = Math.hypot(ux, uy); ux /= size; uy /= size;
        if (ux < 0) { ux = -ux; uy = -uy; }
        for (let y = Math.max(0, Math.floor(cy - size)); y < Math.min(height, cy + size); y++) {
            for (let x = Math.max(0, Math.floor(cx - size)); x < Math.min(width, cx + size); x++) {
                const u = ((x - cx) * ux + (y - cy) * uy) / size;
                const v = (-(x - cx) * uy + (y - cy) * ux) / size;
                if (Math.abs(u) > .8 || Math.abs(v) > .6) continue;
                const open = (u / apertureWidth) ** 2 + ((v - lidShift - apertureSlope * u) / aperture) ** 2 < 1;
                const iris = irisProfile === 'soft_oval'
                    ? 1 / (1 + Math.exp(5 * (((u - .18 * gazeX) / .10) ** 2 + ((v - .12 * gazeY) / .065) ** 2 - 1)))
                    : Math.exp(-((u - .18 * gazeX) ** 2 + (v - .12 * gazeY) ** 2) / (.09 ** 2));
                const reflection = glare ? glare * Math.exp(-((u - .18 * gazeX - .025) ** 2 + (v - .12 * gazeY + .01) ** 2) / (.018 ** 2)) : 0;
                const pattern = texture ? texture * Math.sin(61*u+17*v+texturePhase)*Math.cos(53*v-13*u-texturePhase) : 0;
                const rowLight = rowIllumination ? rowIllumination * Math.sin(19 * v + .6) : 0;
                const value = ((open ? 205 - (irisVisible ? 150 * iris : 0) + reflection : 110) + pattern + rowLight) * contrast + brightness;
                const at = 4 * (y * width + x); data[at] = value; data[at + 1] = value; data[at + 2] = value;
            }
        }
    }
    return { data, width, height };
}

// A separate simulated lid observation, not a gaze label. Deliberate bias and
// scale error let the masked-template oracle test unreliable aperture bounds.
export function syntheticApertureLandmarks(landmarks, { width = 640, height = 480, lidShift = 0, aperture = .23,
    maskShift = 0, maskScale = 1 } = {}) {
    const result = landmarks.slice();
    for (const [a, b, top, bottom] of [[362, 263, 386, 374], [133, 33, 159, 145]]) {
        let dx = (landmarks[b].x - landmarks[a].x) * width, dy = (landmarks[b].y - landmarks[a].y) * height;
        if (dx < 0) { dx = -dx; dy = -dy; }
        const x = (landmarks[a].x + landmarks[b].x) / 2, y = (landmarks[a].y + landmarks[b].y) / 2;
        for (const [index, sign] of [[top, -1], [bottom, 1]]) {
            const v = lidShift + maskShift + sign * aperture * maskScale;
            result[index] = { x: x - v * dy / width, y: y + v * dx / height };
        }
    }
    return result;
}
