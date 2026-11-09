import {
  AudioQuality,
  IOSOutputFormat,
  RecordingOptions,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { addAsset } from '@/db/lectures';

/**
 * Speech-tuned, data-light preset: mono AAC 16 kHz @ 24 kbps ≈ 11 MB/hour.
 * Good enough for transcription, cheap to upload on Nigerian data plans.
 */
const LECTURE_PRESET: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 24000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 24000 },
};

/** Each segment is saved to permanent storage when it ends, so a crash loses ≤ 10 min. */
const SEGMENT_MS = 10 * 60 * 1000;

export type RecorderPhase = 'idle' | 'recording' | 'paused' | 'saving';

export function useLectureRecorder(lectureId: string, onSegmentSaved: () => void) {
  const recorder = useAudioRecorder(LECTURE_PRESET);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0); // total across segments this session
  const [error, setError] = useState<string | null>(null);
  const savedMs = useRef(0);
  const segStart = useRef(0);
  const rolling = useRef(false);

  const saveCurrent = useCallback(async () => {
    const dur = recorder.currentTime * 1000;
    await recorder.stop();
    const uri = recorder.uri;
    if (uri && dur > 1000) {
      await addAsset(lectureId, 'audio', uri, { name: 'lecture.m4a', mime: 'audio/mp4', durationMs: Math.round(dur) });
      savedMs.current += dur;
      onSegmentSaved();
    }
  }, [recorder, lectureId, onSegmentSaved]);

  const begin = useCallback(async () => {
    await recorder.prepareToRecordAsync();
    recorder.record();
    segStart.current = Date.now();
  }, [recorder]);

  const start = useCallback(async () => {
    setError(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('permission');
      return;
    }
    await setAudioModeAsync({
      allowsRecording: true,
      allowsBackgroundRecording: true,
      shouldPlayInBackground: true,
      playsInSilentMode: true,
    });
    savedMs.current = 0;
    await begin();
    setPhase('recording');
  }, [begin]);

  const pause = useCallback(() => {
    recorder.pause();
    setPhase('paused');
  }, [recorder]);

  const resume = useCallback(() => {
    recorder.record();
    setPhase('recording');
  }, [recorder]);

  const stop = useCallback(async () => {
    setPhase('saving');
    try {
      await saveCurrent();
    } finally {
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
      setPhase('idle');
      setElapsedMs(0);
    }
  }, [saveCurrent]);

  // Tick the clock and roll to a new segment every SEGMENT_MS.
  useEffect(() => {
    if (phase !== 'recording') return;
    const iv = setInterval(async () => {
      const cur = recorder.currentTime * 1000;
      setElapsedMs(savedMs.current + cur);
      if (cur >= SEGMENT_MS && !rolling.current) {
        rolling.current = true;
        try {
          await saveCurrent();
          await begin();
        } catch {
          setError('segment');
        } finally {
          rolling.current = false;
        }
      }
    }, 500);
    return () => clearInterval(iv);
  }, [phase, recorder, saveCurrent, begin]);

  return { phase, elapsedMs, error, start, pause, resume, stop };
}
