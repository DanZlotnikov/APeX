// Metro picks LiveCamera.native.tsx on iOS/Android, LiveCamera.web.tsx on web.
// tsc doesn't understand platform extensions, so we point it at the native file.
export { default } from './LiveCamera.native';
export type { LiveCameraHandle } from './types';
