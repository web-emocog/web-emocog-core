// Generated geometric face, not a recording or dataset of a person.
const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,
    152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const groups = [
    [[10,109,67,103,108,9,337,332,297,338], .5,.23,.08,.03],
    [[355,429,358,327,326,2,164,167,393,391,269,270,409,287,410,322], .59,.49,.06,.06],
    [[126,209,129,98,97,2,164,167,168,166,39,40,185,57,186,92], .41,.49,.06,.06],
    [[276,283,282,295,285,336,296,334,293,300,383,372,340,346,263,362,398,384,385,386,387,388,466,373,374,380,381,382], .59,.36,.05,.025],
    [[46,53,52,65,55,107,66,105,63,70,156,143,111,117,33,133,173,157,158,159,160,161,246,144,145,153,154,155], .41,.36,.05,.025],
    [[168,6,197,195,5,4,1,19,94,2,98,327], .5,.47,.025,.05],
    [[61,146,91,181,84,17,314,405,321,375,291,308,324,318,402,317,14,87,178,88,95], .5,.58,.06,.02],
    [[152,148,176,149,150,136,17,200,365,379,378,400,377], .5,.66,.05,.025]
];

export function faceVisibilityFixture({ outside = 2, inside = 3, width = 160, height = 120,
    roll = 0, mirror = false, shiftX = 0, shiftY = 0 } = {}) {
    const landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .45, z: 0 }));
    for (const [indices, cx, cy, rx, ry] of groups) indices.forEach((id, index) => {
        const a = index / indices.length * Math.PI * 2;
        landmarks[id] = { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), z: 0 };
    });
    oval.forEach((id, index) => {
        const a = -Math.PI / 2 + index / oval.length * Math.PI * 2;
        landmarks[id] = { x: .5 + .22 * Math.cos(a), y: .45 + .30 * Math.sin(a), z: 0 };
    });
    for (const point of landmarks) {
        const x = point.x - .5, y = point.y - .45;
        point.x = .5 + (mirror ? -1 : 1) * (x * Math.cos(roll) - y * Math.sin(roll)) + shiftX;
        point.y = .45 + x * Math.sin(roll) + y * Math.cos(roll) + shiftY;
    }
    const polygon = oval.map(id => landmarks[id]);
    const contains = (x, y) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i], b = polygon[j];
            if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    };
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        data[y * width + x] = contains((x + .5) / width, (y + .5) / height) ? inside : outside;
    }
    return { landmarks, data, width, height, contains,
        categoryMask: { width, height, getAsUint8Array: () => data, close() {} } };
}
