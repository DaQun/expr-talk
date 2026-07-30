/**
 * AudioWorklet：把麦克风 float32 帧推到主线程。
 * 主线程负责重采样 / int16 / 批量 IPC，避免在 worklet 里做重逻辑。
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    // 拷贝一份，避免底层 buffer 被复用导致数据错乱
    this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
