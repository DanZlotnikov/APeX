import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { DemoKey } from '../../utils/physioLibrary';
import { physioDemoHtml } from './physioDemoHtml';

interface Props {
  demoKey: DemoKey;
  style?: ViewStyle;
}

export default function PhysioDemo({ demoKey, style }: Props) {
  const containerRef = useRef<any>(null);

  useEffect(() => {
    const el: HTMLElement | null = containerRef.current;
    if (!el) return;

    const blob = new Blob([physioDemoHtml(demoKey)], { type: 'text/html' });
    const blobSrc = URL.createObjectURL(blob);

    const iframe = document.createElement('iframe');
    iframe.src = blobSrc;
    iframe.setAttribute('style', 'width:100%;height:100%;border:none;display:block;pointer-events:none;');
    el.appendChild(iframe);

    return () => {
      URL.revokeObjectURL(blobSrc);
      if (el.contains(iframe)) el.removeChild(iframe);
    };
  }, [demoKey]);

  return <View ref={containerRef} style={[styles.container, style]} />;
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: '#07101C' },
});
