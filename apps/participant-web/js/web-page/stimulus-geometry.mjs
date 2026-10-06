function pixel(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : 0;
}

function position(value, freeSpace) {
    const aliases = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };
    const normalized = aliases[value] || value;
    if (/^-?[\d.]+%$/.test(normalized)) return freeSpace * pixel(normalized) / 100;
    if (/^-?[\d.]+(?:px)?$/.test(normalized)) return pixel(normalized);
    return null;
}

export function mediaContentRect(element, viewport = {}, style = null) {
    if (!element) return null;
    style = style || getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return null;
    const intrinsicWidth = Number(element.naturalWidth || element.videoWidth);
    const intrinsicHeight = Number(element.naturalHeight || element.videoHeight);
    const rect = element.getBoundingClientRect();
    if (![intrinsicWidth, intrinsicHeight, rect.width, rect.height].every(value => Number.isFinite(value) && value > 0)
        || ![rect.left, rect.top].every(Number.isFinite)) return null;
    const insetLeft = pixel(style.borderLeftWidth) + pixel(style.paddingLeft);
    const insetTop = pixel(style.borderTopWidth) + pixel(style.paddingTop);
    const width = rect.width - insetLeft - pixel(style.borderRightWidth) - pixel(style.paddingRight);
    const height = rect.height - insetTop - pixel(style.borderBottomWidth) - pixel(style.paddingBottom);
    if (!(width > 0 && height > 0)) return null;
    const fit = style.objectFit || 'fill';
    // Canonical media uses contain. Cropped/unsupported layouts cannot be safely normalized here.
    if (!['contain', 'scale-down', 'fill'].includes(fit)) return null;
    const scale = Math.min(width / intrinsicWidth, height / intrinsicHeight, fit === 'scale-down' ? 1 : Infinity);
    const renderedWidth = fit === 'fill' ? width : intrinsicWidth * scale;
    const renderedHeight = fit === 'fill' ? height : intrinsicHeight * scale;
    const positions = String(style.objectPosition || '50% 50%').trim().split(/\s+/);
    if (positions.length > 2) return null;
    const x = position(positions[0], width - renderedWidth);
    const y = position(positions[1] || '50%', height - renderedHeight);
    if (x === null || y === null) return null;
    return {
        left: rect.left + insetLeft + x - (Number(viewport.offsetLeft) || 0),
        top: rect.top + insetTop + y - (Number(viewport.offsetTop) || 0),
        width: renderedWidth,
        height: renderedHeight,
        intrinsicWidth,
        intrinsicHeight,
        coordinateMappingVersion: 'media-content-rect.v1',
    };
}
