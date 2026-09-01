class WecogPcmCaptureProcessor extends AudioWorkletProcessor {
    process(inputs, outputs) {
        const input = inputs?.[0]?.[0];
        const output = outputs?.[0]?.[0];
        if (input?.length) {
            const copy = new Float32Array(input);
            this.port.postMessage(copy, [copy.buffer]);
            if (output?.length) output.fill(0);
        }
        return true;
    }
}

registerProcessor('wecog-pcm-capture', WecogPcmCaptureProcessor);
