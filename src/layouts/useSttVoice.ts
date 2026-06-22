// useSttVoice.ts — STT 语音输入 hook（T7：从 AiChatPanel 提取）
import { useState, useCallback } from "react";
import { useSttRecorder } from "@/lib/use-stt";

export interface UseSttVoiceReturn {
  sttLoading: boolean;
  sttRecording: boolean;
  handleSttToggle: () => Promise<void>;
}

export function useSttVoice(setInput: (updater: string | ((prev: string) => string)) => void): UseSttVoiceReturn {
  const stt = useSttRecorder();
  const [sttLoading, setSttLoading] = useState(false);

  const handleSttToggle = useCallback(async () => {
    if (stt.stateRef.current === "recording") {
      setSttLoading(true);
      const text = await stt.stopAndTranscribe();
      setSttLoading(false);
      if (text) setInput(prev => prev + text);
    } else {
      stt.startRecording();
    }
  }, [stt, setInput]);

  return { sttLoading, sttRecording: stt.stateRef.current === "recording", handleSttToggle };
}
