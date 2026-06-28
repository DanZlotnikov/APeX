// Metro resolves PoseView.native.tsx on iOS/Android and PoseView.web.tsx on web.
// We export from PoseView.native here as the default (tsc sees this file; Metro
// overrides per-platform at bundle time via the .native/.web extensions).
export { default } from './PoseView.native';
