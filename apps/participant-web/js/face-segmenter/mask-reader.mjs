// Read GPU masks through the public MPMask texture API. The pinned library's
// RED/FLOAT readback is incompatible with Firefox and probes document on Mac.
export class MaskReader {
    constructor() { this.contexts = new Map(); }

    floats(mask) {
        if (mask.hasFloat32Array?.() || !mask.hasWebGLTexture?.()) return mask.getAsFloat32Array();
        if (mask.hasUint8Array?.()) return new Float32Array(mask.getAsUint8Array()).map(value => value / 255);
        const size = mask.width * mask.height;
        if (![mask.width, mask.height].every(value => Number.isSafeInteger(value) && value > 0)
                || !Number.isSafeInteger(size) || size > 4_194_304) throw new Error('invalid_mask_dimensions');
        const texture = mask.getAsWebGLTexture();
        const gl = mask.canvas?.getContext('webgl2');
        if (!gl || gl.isContextLost()) throw new Error('mask_webgl_unavailable');
        let entry = this.contexts.get(gl);
        if (!entry) {
            const framebuffer = gl.createFramebuffer();
            if (!framebuffer) throw new Error('mask_framebuffer_unavailable');
            entry = { framebuffer, rgba: null, red: null };
            this.contexts.set(gl, entry);
        }
        if (entry.red?.length !== size) {
            entry.rgba = new Float32Array(size * 4);
            entry.red = new Float32Array(size);
        }
        const previous = { framebuffer: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
            buffer: gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),
            row: gl.getParameter(gl.PACK_ROW_LENGTH), rows: gl.getParameter(gl.PACK_SKIP_ROWS),
            pixels: gl.getParameter(gl.PACK_SKIP_PIXELS) };
        try {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, entry.framebuffer);
            gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('mask_framebuffer_incomplete');
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);
            gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
            gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
            gl.readPixels(0, 0, mask.width, mask.height, gl.RGBA, gl.FLOAT, entry.rgba);
            if (gl.getError() !== gl.NO_ERROR) throw new Error('mask_readback_failed');
            for (let i = 0; i < size; i++) entry.red[i] = entry.rgba[i * 4];
            return entry.red;
        } finally {
            gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous.framebuffer);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previous.buffer);
            gl.pixelStorei(gl.PACK_ROW_LENGTH, previous.row);
            gl.pixelStorei(gl.PACK_SKIP_ROWS, previous.rows);
            gl.pixelStorei(gl.PACK_SKIP_PIXELS, previous.pixels);
        }
    }

    bytes(mask) {
        if (mask.hasUint8Array?.() || !mask.hasWebGLTexture?.()) return mask.getAsUint8Array();
        // Preserve 0.10.14's float32 multiplication followed by Uint8 truncation.
        return new Uint8Array(this.floats(mask).map(value => 255 * value));
    }

    dispose() {
        for (const [gl, entry] of this.contexts) gl.deleteFramebuffer(entry.framebuffer);
        this.contexts.clear();
    }
}
