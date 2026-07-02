// Metro resolves PhysioDemo.native.tsx on iOS/Android and PhysioDemo.web.tsx on
// web. This file is what tsc sees; Metro overrides per-platform at bundle time.
export { default } from './PhysioDemo.native';
