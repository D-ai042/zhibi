/**
 * useSttRecorder — 录音 + 调用 STT API 转文字
 *
 * 1. 用 MediaRecorder 录音（需 getUserMedia 授权）
 * 2. 录音结束后将音频 blob 转 WAV 格式（百度 STT 需要 WAV/PCM）
 * 3. 将 WAV 转 base64 后调用 api.sttTranscribe
 */

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";

type SttState = "idle" | "recording" | "transcribing" | "error";

/** 将浏览器录制的 WebM blob 转为 WAV 格式（16bit 单声道 16000Hz） */
async function convertToWav(blob: Blob): Promise<Blob> {
    const arrayBuffer = await blob.arrayBuffer();
    // AudioContext 的 sampleRate 参数在某些环境下可能不受支持，回退到无参数构造
    let audioCtx: AudioContext;
    try {
        audioCtx = new AudioContext({ sampleRate: 16000 });
    } catch {
        audioCtx = new AudioContext();
    }
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    await audioCtx.close();

    const numChannels = 1; // 强制单声道
    const sampleRate = 16000;
    const bitsPerSample = 16;
    const length = audioBuffer.length;
    const channelData = audioBuffer.getChannelData(0); // 取第一个声道

    // 如果多声道则混音
    let samples: Float32Array;
    if (audioBuffer.numberOfChannels > 1) {
        samples = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            let sum = 0;
            for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
                sum += audioBuffer.getChannelData(ch)[i];
            }
            samples[i] = sum / audioBuffer.numberOfChannels;
        }
    } else {
        samples = channelData;
    }

    // 重采样到 16000Hz（如果浏览器返回的采样率不同）
    let finalSamples: Float32Array;
    if (audioBuffer.sampleRate !== sampleRate) {
        const ratio = sampleRate / audioBuffer.sampleRate;
        const newLength = Math.round(length * ratio);
        finalSamples = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
            const srcIdx = i / ratio;
            const srcIdx0 = Math.floor(srcIdx);
            const srcIdx1 = Math.min(srcIdx0 + 1, length - 1);
            const frac = srcIdx - srcIdx0;
            finalSamples[i] = samples[srcIdx0] * (1 - frac) + samples[srcIdx1] * frac;
        }
    } else {
        finalSamples = samples;
    }

    // 编码为 WAV
    const dataLength = finalSamples.length * (bitsPerSample / 8);
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < finalSamples.length; i++) {
        const sample = Math.max(-1, Math.min(1, finalSamples[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
}

export function useSttRecorder() {
    const [state, setState] = useState<SttState>("idle");
    const [errorMsg, setErrorMsg] = useState("");
    const stateRef = useRef<SttState>("idle");
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    // 同步 state 到 ref
    const updateState = useCallback((s: SttState) => {
        setState(s);
        stateRef.current = s;
    }, []);

    /** 检查麦克风 API 是否可用 */
    const isMediaDevicesSupported = typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia;

    /** 请求麦克风权限 */
    const requestMic = useCallback(async (): Promise<boolean> => {
        if (!isMediaDevicesSupported) {
            return false;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
            return true;
        } catch {
            return false;
        }
    }, [isMediaDevicesSupported]);

    /** 开始录音 */
    const startRecording = useCallback(async (): Promise<boolean> => {
        if (!isMediaDevicesSupported) {
            setState("error");
            setErrorMsg("当前环境不支持麦克风访问，请检查系统麦克风权限设置");
            return false;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : "audio/webm";

            const recorder = new MediaRecorder(stream, { mimeType });
            chunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
            };

            recorder.start(100);
            mediaRecorderRef.current = recorder;
            updateState("recording");
            setErrorMsg("");
            return true;
        } catch {
            updateState("error");
            setErrorMsg("启动录音失败");
            return false;
        }
    }, [requestMic, updateState]);

    /** 停止录音并转文字 */
    const stopAndTranscribe = useCallback(async (): Promise<string> => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === "inactive") {
            updateState("idle");
            return "";
        }

        return new Promise((resolve) => {
            recorder.onstop = async () => {
                const stream = recorder.stream;
                stream.getTracks().forEach(t => t.stop());

                const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
                chunksRef.current = [];
                mediaRecorderRef.current = null;

                if (blob.size < 100) {
                    setState("idle");
                    resolve("");
                    return;
                }

                // 转 base64（先转 WAV，百度 STT 不支持 WebM）
                setState("transcribing");

                try {
                    const wavBlob = await convertToWav(blob);
                    const reader = new FileReader();
                    reader.onload = async () => {
                        const base64 = (reader.result as string).split(",")[1];
                        try {
                            const res = await api.sttTranscribe(base64);
                            updateState("idle");
                            resolve(res.text || "");
                        } catch {
                            updateState("error");
                            setErrorMsg("语音识别请求失败");
                            resolve("");
                        }
                    };
                    reader.onerror = () => {
                        updateState("error");
                        setErrorMsg("音频编码失败");
                        resolve("");
                    };
                    reader.readAsDataURL(wavBlob);
                } catch {
                    setState("error");
                    setErrorMsg("音频转换失败");
                    resolve("");
                }
            };

            recorder.stop();
        });
    }, []);

    /** 取消录音 */
    const cancel = useCallback(() => {
        try {
            mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
            mediaRecorderRef.current?.stop();
        } catch { /* ignore */ }
        mediaRecorderRef.current = null;
        chunksRef.current = [];
        updateState("idle");
    }, [updateState]);

    return { state, errorMsg, stateRef, startRecording, stopAndTranscribe, cancel };
}
