/**
 * Coordinates used by gaze are CSS pixels inside the page content viewport.
 * Browser chrome/tabs are outside this coordinate space by definition.
 */
export function getContentViewport(win = window) {
    const visual = win.visualViewport;
    return {
        width: visual?.width || win.innerWidth || 1,
        height: visual?.height || win.innerHeight || 1,
        offsetLeft: visual?.offsetLeft || 0,
        offsetTop: visual?.offsetTop || 0,
        scale: visual?.scale || 1
    };
}

export function targetCenterInContentViewport(element, win = window) {
    if (!element?.getBoundingClientRect) return null;
    const rect = element.getBoundingClientRect();
    const viewport = getContentViewport(win);
    return {
        x: rect.left + rect.width / 2 - viewport.offsetLeft,
        y: rect.top + rect.height / 2 - viewport.offsetTop,
        viewport
    };
}

export function contentToLayoutViewport(point, win = window) {
    const viewport = getContentViewport(win);
    return {
        x: point.x + viewport.offsetLeft,
        y: point.y + viewport.offsetTop
    };
}
