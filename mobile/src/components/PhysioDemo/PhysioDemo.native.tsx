import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import WebView from 'react-native-webview';
import { DemoKey } from '../../utils/physioLibrary';
import { physioDemoHtml } from './physioDemoHtml';

interface Props {
  demoKey: DemoKey;
  style?: ViewStyle;
}

export default function PhysioDemo({ demoKey, style }: Props) {
  const source = useMemo(() => ({ html: physioDemoHtml(demoKey) }), [demoKey]);

  return (
    // pointerEvents none on the wrapper lets scroll gestures pass to the parent
    // ScrollView — the demo is purely decorative.
    <View style={[styles.container, style]} pointerEvents="none">
      <WebView
        source={source}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        style={styles.web}
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: '#07101C' },
  web: { flex: 1, backgroundColor: '#07101C' },
});
