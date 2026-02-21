import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
} from 'react-native';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title}>Sahey</Text>
      <Text style={styles.subtitle}>A simple app</Text>

      <View style={styles.counterCard}>
        <Text style={styles.counterLabel}>Count</Text>
        <Text style={styles.counterValue}>{count}</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.buttonMinus]}
            onPress={() => setCount((c) => c - 1)}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.buttonPlus]}
            onPress={() => setCount((c) => c + 1)}
            activeOpacity={0.8}
          >
            <Text style={[styles.buttonText, styles.buttonTextPlus]}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f7',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
    ...(Platform.OS === 'web' && { fontFamily: 'system-ui, sans-serif' }),
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 40,
    ...(Platform.OS === 'web' && { fontFamily: 'system-ui, sans-serif' }),
  },
  counterCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    minWidth: 260,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  counterLabel: {
    fontSize: 14,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    ...(Platform.OS === 'web' && { fontFamily: 'system-ui, sans-serif' }),
  },
  counterValue: {
    fontSize: 56,
    fontWeight: '200',
    color: '#1a1a1a',
    marginBottom: 24,
    ...(Platform.OS === 'web' && { fontFamily: 'system-ui, sans-serif' }),
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonMinus: {
    backgroundColor: '#eee',
  },
  buttonPlus: {
    backgroundColor: '#1a1a1a',
  },
  buttonText: {
    fontSize: 28,
    color: '#1a1a1a',
    fontWeight: '300',
    marginTop: -2,
  },
  buttonTextPlus: {
    color: '#fff',
  },
});
