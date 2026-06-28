export interface LiveCameraHandle {
  startRecording: (maxSeconds: number) => Promise<void>;
  stopRecording: () => void;
  flipCamera: () => void;
}
