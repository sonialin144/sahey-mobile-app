import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  PermissionsAndroid,
  Dimensions,
  Pressable,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
// BLE manager is optional (not available in Expo Go)
let BleManagerClass = null;
let BleState = null;
let bleManager = null;
let bleNativeModuleError =
  'To use Bluetooth device features, create a development build of this app instead of running in Expo Go.';

try {
  // This may fail in Expo Go because react-native-ble-plx is not supported there.
  // eslint-disable-next-line global-require
  const BlePlx = require('react-native-ble-plx');
  BleManagerClass = BlePlx.BleManager;
  BleState = BlePlx.State;

  try {
    // In Expo Go, constructing BleManager can still throw because
    // the underlying native module is missing. Guard that as well.
    bleManager = new BleManagerClass();
    bleNativeModuleError = '';
  } catch (nativeErr) {
    bleManager = null;
    // Keep the short guidance-only message
    bleNativeModuleError =
      'To use Bluetooth device features, create a development build of this app instead of running in Expo Go.';
  }
} catch (e) {
  bleManager = null;
  // Keep the short guidance-only message
  bleNativeModuleError =
    'To use Bluetooth device features, create a development build of this app instead of running in Expo Go.';
}

/** Native OS BT permissions only — no custom permission UI. */
async function requestBluetoothPermissions() {
  if (!bleManager) return false;
  if (Platform.OS === 'android') {
    const apiLevel = Platform.Version;
    const perms = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ...(apiLevel >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ]
        : []),
    ].filter(Boolean);
    const result = await PermissionsAndroid.requestMultiple(perms);
    const denied = Object.keys(result).find((k) => result[k] !== PermissionsAndroid.RESULTS.GRANTED);
    return !denied;
  }
  const state = await bleManager.state();
  const U = BleState?.Unauthorized ?? 'Unauthorized';
  const Off = BleState?.PoweredOff ?? 'PoweredOff';
  if (state === U) return false;
  if (state === Off) {
    Alert.alert('Bluetooth is off', 'Turn on Bluetooth to connect your wristband.');
    return false;
  }
  return true;
}

function deviceNameMatchesSahey(device) {
  const n = String(device?.name || '').toLowerCase();
  const ln = String(device?.localName || '').toLowerCase();
  return n.includes('sahey') || ln.includes('sahey');
}

function signalLabel(rssi) {
  if (typeof rssi !== 'number') return 'Strong signal';
  if (rssi >= -55) return 'Strong signal';
  if (rssi >= -70) return 'Good signal';
  return 'Fair signal';
}

function formatContactCount(n) {
  return `${n} ${n === 1 ? 'contact' : 'contacts'}`;
}

function relativeTimeFrom(date) {
  if (!date) return '';
  const ms = Date.now() - date.getTime();
  if (ms < 60 * 1000) return 'just now';
  const minutes = Math.max(1, Math.round(ms / (60 * 1000)));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

const CONTACTS_SERVICE_UUID = '12345678-1234-5678-1234-56789abcdef0';
const CONTACTS_CHAR_UUID = '12345678-1234-5678-1234-56789abcdef1';

const LAST_BLE_DEVICE_KEY = '@sahey_last_ble_device_v1';
const CONTACTS_STORAGE_KEY = '@sahey_contacts_v1';
const SYNCED_CONTACT_IDS_KEY = '@sahey_synced_contact_ids_v1';
const LAST_SYNCED_AT_KEY = '@sahey_last_synced_at_v1';

async function persistLastBleDevice(deviceId, name) {
  try {
    await AsyncStorage.setItem(
      LAST_BLE_DEVICE_KEY,
      JSON.stringify({ id: deviceId, name: name || 'Sahey Band' }),
    );
  } catch (_) {
    /* ignore */
  }
}

async function clearLastBleDevice() {
  try {
    await AsyncStorage.removeItem(LAST_BLE_DEVICE_KEY);
  } catch (_) {
    /* ignore */
  }
}

async function loadLastBleDevice() {
  try {
    const raw = await AsyncStorage.getItem(LAST_BLE_DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && parsed.id.length > 0) {
      return { id: parsed.id, name: typeof parsed.name === 'string' ? parsed.name : 'Sahey Band' };
    }
    return null;
  } catch {
    return null;
  }
}

async function loadPersistedContacts() {
  try {
    const [contactsRaw, syncedRaw, lastRaw] = await Promise.all([
      AsyncStorage.getItem(CONTACTS_STORAGE_KEY),
      AsyncStorage.getItem(SYNCED_CONTACT_IDS_KEY),
      AsyncStorage.getItem(LAST_SYNCED_AT_KEY),
    ]);

    const parsedContacts = contactsRaw ? JSON.parse(contactsRaw) : null;
    const parsedSynced = syncedRaw ? JSON.parse(syncedRaw) : null;
    const parsedLast = lastRaw ? new Date(lastRaw) : null;

    return {
      contacts: Array.isArray(parsedContacts) ? parsedContacts : null,
      syncedContactIds: Array.isArray(parsedSynced) ? parsedSynced : null,
      lastSyncedAt: parsedLast && !Number.isNaN(parsedLast.getTime()) ? parsedLast : null,
    };
  } catch (_) {
    return { contacts: null, syncedContactIds: null, lastSyncedAt: null };
  }
}

async function persistContacts(nextContacts) {
  try {
    await AsyncStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(nextContacts));
  } catch (_) {
    /* ignore */
  }
}

async function persistSyncedContactIds(nextIds) {
  try {
    await AsyncStorage.setItem(SYNCED_CONTACT_IDS_KEY, JSON.stringify(nextIds));
  } catch (_) {
    /* ignore */
  }
}

async function persistLastSyncedAt(nextDate) {
  try {
    if (!nextDate) {
      await AsyncStorage.removeItem(LAST_SYNCED_AT_KEY);
      return;
    }
    await AsyncStorage.setItem(LAST_SYNCED_AT_KEY, nextDate.toISOString());
  } catch (_) {
    /* ignore */
  }
}

function toBase64(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = Array.from(str).map((c) => c.charCodeAt(0));
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < bytes.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b3 & 63] : '=';
  }
  return result;
}

export default function App() {
  const [currentTab, setCurrentTab] = useState('home'); 
  const [contacts, setContacts] = useState([
    { id: '1', name: 'Mom', phone: '(555) 123-4567' },
  ]);
  
  // Voice Commands State
  const [voiceCommands, setVoiceCommands] = useState([
    { id: '1', phrase: 'Pineapple', enabled: true },
    { id: '2', phrase: 'Green Apple', enabled: true },
    { id: '3', phrase: 'Grape juice', enabled: false },
  ]);

  const toggleCommand = (id) => {
    setVoiceCommands(prev => prev.map(cmd => 
      cmd.id === id ? { ...cmd, enabled: !cmd.enabled } : cmd
    ));
  };

  const updateCommandPhrase = (id, newPhrase) => {
    setVoiceCommands(prev => prev.map(cmd => 
      cmd.id === id ? { ...cmd, phrase: newPhrase } : cmd
    ));
  };

  const [isDeviceConnected, setIsDeviceConnected] = useState(false);
  const [contactsEditing, setContactsEditing] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [connectedDeviceId, setConnectedDeviceId] = useState(null);
  const [connectedDeviceName, setConnectedDeviceName] = useState('');
  // Wristband sync state (source of truth for "what's on the device")
  const [syncedContactIds, setSyncedContactIds] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null); // Date | null
  // Contacts flow view (main list vs sync screens)
  const [contactsView, setContactsView] = useState('main'); // 'main' | 'preview' | 'syncing' | 'success'
  const [syncRunMeta, setSyncRunMeta] = useState(null); // { mode: 'never' | 'delta', addedCount: number }
  const didHydrateContactsRef = useRef(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalInternalVisible, setModalInternalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [contactsError, setContactsError] = useState('');
  const [pickingFromPhone, setPickingFromPhone] = useState(false);
  const modalAnim = useState(new Animated.Value(0))[0];
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [deviceView, setDeviceView] = useState('main'); // 'main' | 'search'
  const [deviceOptionsVisible, setDeviceOptionsVisible] = useState(false);
  const [deviceSheetModalShown, setDeviceSheetModalShown] = useState(false);
  const deviceSheetProgress = useRef(new Animated.Value(0)).current;
  const [autoReconnecting, setAutoReconnecting] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [lastAutoSyncIdsKey, setLastAutoSyncIdsKey] = useState(null);
  const autoSyncSuccessTimerRef = useRef(null);

  const handleConnectPress = useCallback(async () => {
    if (!bleManager) {
      Alert.alert('Bluetooth unavailable', bleNativeModuleError || 'Bluetooth is not available.');
      return;
    }
    const ok = await requestBluetoothPermissions();
    if (!ok) return;
    setDeviceView('search');
  }, []);

  useEffect(() => {
    if (modalVisible) {
      setModalInternalVisible(true);
      Animated.timing(modalAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else if (modalInternalVisible) {
      Animated.timing(modalAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setModalInternalVisible(false);
        }
      });
    }
  }, [modalVisible, modalInternalVisible, modalAnim]);

  useEffect(() => {
    const subShow = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
    });
    const subHide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  // Persisted contacts + sync status (what's on the wristband)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const persisted = await loadPersistedContacts();
      if (cancelled) return;
      if (persisted.contacts) setContacts(persisted.contacts);
      if (persisted.syncedContactIds) setSyncedContactIds(persisted.syncedContactIds);
      if (persisted.lastSyncedAt) setLastSyncedAt(persisted.lastSyncedAt);
      didHydrateContactsRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!didHydrateContactsRef.current) return;
    persistContacts(contacts);
  }, [contacts]);

  useEffect(() => {
    if (!didHydrateContactsRef.current) return;
    persistSyncedContactIds(syncedContactIds);
  }, [syncedContactIds]);

  useEffect(() => {
    if (!didHydrateContactsRef.current) return;
    persistLastSyncedAt(lastSyncedAt);
  }, [lastSyncedAt]);

  useEffect(() => {
    if (deviceOptionsVisible) {
      if (!deviceSheetModalShown) {
        setDeviceSheetModalShown(true);
        deviceSheetProgress.setValue(0);
        Animated.timing(deviceSheetProgress, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }).start();
      }
    } else if (deviceSheetModalShown) {
      Animated.timing(deviceSheetProgress, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setDeviceSheetModalShown(false);
        }
      });
    }
  }, [deviceOptionsVisible, deviceSheetModalShown, deviceSheetProgress]);

  /** On cold start: reconnect to last paired device if we have a saved id (no scan UI). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!bleManager) return;
      const saved = await loadLastBleDevice();
      if (!saved || cancelled) return;

      const ok = await requestBluetoothPermissions();
      if (!ok || cancelled) return;

      setAutoReconnecting(true);
      try {
        const device = await bleManager.connectToDevice(saved.id, {
          timeout: 12000,
          requestMTU: 256,
        });
        await device.discoverAllServicesAndCharacteristics();
        if (cancelled) {
          await bleManager.cancelDeviceConnection(device.id).catch(() => {});
          return;
        }
        const nm = device.name || device.localName || saved.name || 'Sahey Band';
        setConnectedDeviceId(device.id);
        setConnectedDeviceName(nm);
        setIsDeviceConnected(true);
        await persistLastBleDevice(device.id, nm);
      } catch (_) {
        /* Out of range or id changed — user can tap Connect to scan again */
      } finally {
        if (!cancelled) setAutoReconnecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!connectedDeviceId || !bleManager) return;

    const subscription = bleManager.onDeviceDisconnected(connectedDeviceId, () => {
      setIsDeviceConnected(false);
      setConnectedDeviceId(null);
      setConnectedDeviceName('');
    });

    return () => subscription.remove();
  }, [connectedDeviceId]);

  const disconnectDevice = useCallback(async () => {
    if (!connectedDeviceId || !bleManager) return;
    try {
      await bleManager.cancelDeviceConnection(connectedDeviceId);
    } catch (_) {
      // already disconnected
    }
    await clearLastBleDevice();
    setIsDeviceConnected(false);
    setConnectedDeviceId(null);
    setConnectedDeviceName('');
  }, [connectedDeviceId]);

  // Keep syncedContactIds aligned with the current contacts list.
  useEffect(() => {
    setSyncedContactIds((prev) =>
      prev.filter((id) => contacts.some((c) => c.id === id))
    );
  }, [contacts]);

  const addContact = () => {
    if (newName && newPhone) {
      setContacts([...contacts, { id: Date.now().toString(), name: newName, phone: newPhone }]);
      setNewName('');
      setNewPhone('');
      setContactsError('');
      setModalVisible(false);
    }
  };

  const pickContactFromPhone = useCallback(async () => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    setContactsError('');
    setPickingFromPhone(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted' && status !== 'undetermined') {
        setContactsError('Contact access was denied.');
        setPickingFromPhone(false);
        return;
      }
      const contact = await Contacts.presentContactPickerAsync();
      setPickingFromPhone(false);
      if (!contact) return;
      const name = contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unnamed';
      const phone = contact.phoneNumbers?.[0]?.number ?? '';
      if (!phone) {
        setContactsError('This contact has no phone number.');
        return;
      }
      setContacts(prev => [...prev, { id: contact.id || Date.now().toString(), name, phone }]);
      setModalVisible(false);
    } catch (e) {
      setContactsError(e.message || 'Could not open contact picker.');
      setPickingFromPhone(false);
    }
  }, []);

  const toggleContactsEdit = useCallback(() => {
    setContactsEditing((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedContactIds([]);
      }
      return next;
    });
  }, []);

  const toggleContactSelected = useCallback((id) => {
    setSelectedContactIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((existingId) => existingId !== id);
      }
      return [...prev, id];
    });
  }, []);

  const deleteSelectedContacts = useCallback(() => {
    if (selectedContactIds.length === 0) return;

    Alert.alert(
      'Remove contacts?',
      'Are you sure you want to remove the selected emergency contacts?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Firmware overwrites the entire list on END, so deleting must force a re-sync.
            setSyncedContactIds([]);
            setContacts((prev) =>
              prev.filter((c) => !selectedContactIds.includes(c.id))
            );
            setSelectedContactIds([]);
            setContactsEditing(false);
          },
        },
      ]
    );
  }, [selectedContactIds]);

  const unsyncedContacts = contacts.filter((c) => !syncedContactIds.includes(c.id));
  const syncedContacts = contacts.filter((c) => syncedContactIds.includes(c.id));
  const hasUnsynced = unsyncedContacts.length > 0;
  const neverSynced = syncedContactIds.length === 0;
  const lastSyncedRelative = relativeTimeFrom(lastSyncedAt);
  const unsyncedIdsKey = unsyncedContacts.map((c) => c.id).sort().join('|');

  useEffect(() => {
    if (!didHydrateContactsRef.current) return;
    if (!isDeviceConnected) return;
    if (currentTab !== 'contacts') return;
    if (contactsView !== 'main') return;
    if (contactsEditing) return;
    if (!hasUnsynced) return;
    if (autoSyncing) return;
    if (!unsyncedIdsKey) return;
    if (unsyncedIdsKey === lastAutoSyncIdsKey) return;

    setLastAutoSyncIdsKey(unsyncedIdsKey);
    setAutoSyncing(true);
    setSyncRunMeta({
      mode: neverSynced ? 'never' : 'delta',
      addedCount: unsyncedContacts.length,
    });
    setContactsView('syncing');
  }, [
    isDeviceConnected,
    currentTab,
    contactsView,
    contactsEditing,
    hasUnsynced,
    neverSynced,
    unsyncedIdsKey,
    lastAutoSyncIdsKey,
    autoSyncing,
    unsyncedContacts.length,
  ]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {/* TAB 1: HOME */}
          {currentTab === 'home' && (
            deviceView === 'main' ? (
              <HomeScreen
                onConnectPress={handleConnectPress}
                isConnected={isDeviceConnected}
                autoReconnecting={autoReconnecting}
                onOpenDeviceOptions={() => setDeviceOptionsVisible(true)}
                onViewContacts={() => setCurrentTab('contacts')}
                contactCount={contacts.length}
              />
            ) : (
              <DeviceSearchScreen
                onClose={() => setDeviceView('main')}
                onConnected={(deviceId, name) => {
                  setIsDeviceConnected(true);
                  setConnectedDeviceId(deviceId);
                  setConnectedDeviceName(name || 'Sahey Band');
                  persistLastBleDevice(deviceId, name || 'Sahey Band');
                }}
              />
            )
          )}

          {/* TAB 2: COMMANDS */}
          {currentTab === 'commands' && (
            <CommandsScreen
              commands={voiceCommands}
              onToggleCommand={toggleCommand}
              onUpdatePhrase={updateCommandPhrase}
            />
          )}

          {/* TAB 3: CONTACTS */}
          {currentTab === 'contacts' && contactsView === 'main' && (
            <ContactsScreen
              contacts={contacts}
              setModalVisible={setModalVisible}
              isEditing={contactsEditing}
              onToggleEdit={toggleContactsEdit}
              selectedIds={selectedContactIds}
              onToggleSelect={toggleContactSelected}
              onDeleteSelected={deleteSelectedContacts}
              isDeviceConnected={isDeviceConnected}
              syncedContactIds={syncedContactIds}
              unsyncedContacts={unsyncedContacts}
              neverSynced={neverSynced}
              hasUnsynced={hasUnsynced}
              lastSyncedRelative={lastSyncedRelative}
              onOpenSyncPreview={() => {
                if (!isDeviceConnected || contacts.length === 0) return;
                setContactsView('preview');
              }}
            />
          )}

          {currentTab === 'contacts' && contactsView === 'preview' && (
            <ContactsSyncPreviewScreen
              contacts={contacts}
              unsyncedContacts={unsyncedContacts}
              syncedContacts={syncedContacts}
              neverSynced={neverSynced}
              onBack={() => setContactsView('main')}
              onStartSync={() => {
                setSyncRunMeta({
                  mode: neverSynced ? 'never' : 'delta',
                  addedCount: unsyncedContacts.length,
                });
                setContactsView('syncing');
              }}
              formatContactCount={formatContactCount}
            />
          )}

          {currentTab === 'contacts' && contactsView === 'syncing' && (
            <ContactsSyncExecutionScreen
              connectedDeviceId={connectedDeviceId}
              isDeviceConnected={isDeviceConnected}
              bleManager={bleManager}
              contacts={contacts}
              unsyncedContacts={unsyncedContacts}
              syncedContacts={syncedContacts}
              neverSynced={neverSynced}
              onCancel={() => {
                setAutoSyncing(false);
                setContactsView('main');
              }}
              onSuccess={() => {
                setSyncedContactIds(contacts.map((c) => c.id));
                setLastSyncedAt(new Date());
                if (autoSyncing) setAutoSyncing(false);
                if (autoSyncSuccessTimerRef.current) {
                  clearTimeout(autoSyncSuccessTimerRef.current);
                }
                setContactsView('main');
              }}
              syncRunMeta={syncRunMeta}
              signalLabel={signalLabel}
            />
          )}

          {/* Success screen intentionally omitted: we rely on per-contact synced indicators. */}
        </View>

        {/* Bottom Navigation */}
        <View style={styles.bottomTab}>
          <TouchableOpacity style={styles.tabItem} onPress={() => setCurrentTab('home')}>
            <MaterialCommunityIcons 
              name="watch-variant" 
              size={28} 
              color={currentTab === 'home' ? '#3898FC' : '#999'} 
            />
            <Text style={[styles.tabText, currentTab === 'home' && styles.tabActive]}>Device</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.tabItem} onPress={() => setCurrentTab('commands')}>
            <MaterialCommunityIcons 
              name="microphone" 
              size={28} 
              color={currentTab === 'commands' ? '#3898FC' : '#999'} 
            />
            <Text style={[styles.tabText, currentTab === 'commands' && styles.tabActive]}>Commands</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.tabItem} onPress={() => setCurrentTab('contacts')}>
            <MaterialCommunityIcons 
              name="account-group" 
              size={28} 
              color={currentTab === 'contacts' ? '#3898FC' : '#999'} 
            />
            <Text style={[styles.tabText, currentTab === 'contacts' && styles.tabActive]}>Contacts</Text>
          </TouchableOpacity>
        </View>

        <Modal
          visible={modalInternalVisible}
          transparent
          animationType="none"
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={1}
              onPress={() => setModalVisible(false)}
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={0}
              style={{ flex: 1, justifyContent: 'flex-end' }}
            >
              <View style={{ marginBottom: Platform.OS === 'android' ? keyboardHeight : 0, width: '100%' }}>
                <Animated.View
                  style={[
                    styles.modalContent,
                    {
                      transform: [
                        {
                          translateY: modalAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [420, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Text style={styles.modalTitle}>Add emergency contact</Text>

                <TouchableOpacity
                  style={styles.pickFromPhoneButton}
                  onPress={pickContactFromPhone}
                  disabled={pickingFromPhone}
                >
                  {pickingFromPhone ? (
                    <ActivityIndicator color="#3898FC" />
                  ) : (
                    <MaterialCommunityIcons name="book-account" size={22} color="#3898FC" />
                  )}
                  <Text style={styles.pickFromPhoneText}>
                    {pickingFromPhone ? 'Opening…' : 'Pick from phone'}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.modalDivider}>— or enter manually —</Text>

                {contactsError ? (
                  <Text style={styles.contactsError}>{contactsError}</Text>
                ) : null}

                <TextInput
                  style={styles.input}
                  placeholder="Name"
                  placeholderTextColor="#999"
                  value={newName}
                  onChangeText={setNewName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Phone number"
                  placeholderTextColor="#999"
                  keyboardType="phone-pad"
                  value={newPhone}
                  onChangeText={setNewPhone}
                />

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnCancel]}
                      onPress={() => {
                        setModalVisible(false);
                        setContactsError('');
                      }}
                    >
                      <Text style={{ fontWeight: '700', color: '#333' }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, styles.btnSave]} onPress={addContact}>
                      <Text style={{ fontWeight: '700', color: '#FFF' }}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        <Modal
          visible={deviceSheetModalShown}
          transparent
          animationType="none"
          onRequestClose={() => setDeviceOptionsVisible(false)}
        >
          <View style={styles.deviceSheetRoot}>
            <Animated.View
              style={[
                styles.deviceSheetBackdropFill,
                {
                  opacity: deviceSheetProgress,
                },
              ]}
            >
              <Pressable
                style={StyleSheet.absoluteFillObject}
                onPress={() => setDeviceOptionsVisible(false)}
              />
            </Animated.View>
            <Animated.View
              style={[
                styles.deviceSheetPanelWrap,
                {
                  transform: [
                    {
                      translateY: deviceSheetProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [Math.min(360, Dimensions.get('window').height * 0.45), 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.deviceSheetPanel}>
                <View style={styles.deviceSheetHandle} />
                <Text style={styles.deviceSheetSectionLabel} numberOfLines={1}>
                  {(connectedDeviceName || 'Sahey Band').toUpperCase()}
                </Text>
                <TouchableOpacity
                  style={styles.deviceSheetDisconnectCard}
                  activeOpacity={0.85}
                  onPress={async () => {
                    setDeviceOptionsVisible(false);
                    await disconnectDevice();
                  }}
                >
                  <MaterialCommunityIcons name="close" size={22} color="#B91C1C" />
                  <Text style={styles.deviceSheetDisconnectTitle}>Disconnect device</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deviceSheetCancelBtn}
                  onPress={() => setDeviceOptionsVisible(false)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.deviceSheetCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function formatPhoneForDisplay(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');

  // US-style 10 or 11 digits -> +1 (555) 123 - 4567
  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const mid = digits.slice(3, 6);
    const last = digits.slice(6);
    return `+1 (${area}) ${mid}-${last}`;
  }

  if (digits.length === 11 && digits[0] === '1') {
    const area = digits.slice(1, 4);
    const mid = digits.slice(4, 7);
    const last = digits.slice(7);
    return `+1 (${area}) ${mid}-${last}`;
  }

  // Fallback: return original string if we don't recognize the pattern
  return String(raw);
}

// --- HOME SCREEN ---
const HomeScreen = ({
  onConnectPress,
  isConnected,
  autoReconnecting,
  onOpenDeviceOptions,
  onViewContacts,
  contactCount,
}) => {
  const statusLine = isConnected
    ? 'Connected'
    : autoReconnecting
      ? 'Reconnecting…'
      : 'Not connected';
  return (
  <View style={styles.screenInner}>
    <View style={styles.headerRow}>
      <View>
        <Text style={styles.title}>SAHEY</Text>
        <View style={styles.statusBadge}>
          <View
            style={[
              styles.pulseDot,
              !isConnected && !autoReconnecting && styles.pulseDotOff,
              autoReconnecting && styles.pulseDotReconnect,
            ]}
          />
          <Text
            style={[
              styles.statusText,
              !isConnected && !autoReconnecting && styles.statusTextOff,
              autoReconnecting && styles.statusTextReconnect,
            ]}
          >
            {statusLine}
          </Text>
        </View>
      </View>
      <View style={styles.batteryContainer}>
        <MaterialCommunityIcons name="battery-80" size={24} color="#4CAF50" />
        <Text style={styles.batteryText}>84%</Text>
      </View>
    </View>

    <View style={styles.imageContainer}>
      {isConnected ? (
        <TouchableOpacity
          style={styles.imageContainerMenuBtn}
          onPress={onOpenDeviceOptions}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="dots-horizontal" size={22} color="#333" />
        </TouchableOpacity>
      ) : null}
      <MaterialCommunityIcons
        name="watch-variant"
        size={140}
        color="#3898FC"
      />
      <Text style={styles.imageLabel}>Wristband v1.0.4</Text>
      {isConnected ? (
        <View style={styles.connectedPill}>
          <View style={styles.connectedPillDot} />
          <Text style={styles.connectedPillText}>Connected</Text>
        </View>
      ) : autoReconnecting ? (
        <View style={styles.homeReconnectingBox}>
          <ActivityIndicator color="#3898FC" style={{ marginBottom: 10 }} />
          <Text style={styles.connectInfo}>Reconnecting to your wristband…</Text>
        </View>
      ) : (
        <>
          <Text style={styles.connectInfo}>
            Connect your device to unlock device features!
          </Text>
          <TouchableOpacity style={[styles.connectButton, styles.homeConnectButton]} onPress={onConnectPress}>
            <MaterialCommunityIcons name="bluetooth" size={20} color="#FFF" />
            <Text style={styles.connectButtonText}>Connect</Text>
          </TouchableOpacity>
        </>
      )}
    </View>

    <Text style={styles.sectionTitle}>Emergency Contacts</Text>
    
    <TouchableOpacity 
      style={styles.contactConfigBox} 
      onPress={onViewContacts} // <--- Use the new prop here
    >
      <View style={styles.contactLeftSection}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="account-group" size={22} color="#3898FC" />
        </View>
        <Text style={styles.contactConfigText}>
          {contactCount} {contactCount === 1 ? 'Contact' : 'Contacts'} Configured
        </Text>
      </View>
      
      <View style={styles.viewLinkContainer}>
        <Text style={styles.viewLinkText}>View</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color="#3898FC" />
      </View>
    </TouchableOpacity>
  </View>
  );
};

// --- CONTACTS SCREEN ---
const ContactsScreen = ({
  contacts,
  setModalVisible,
  isEditing,
  onToggleEdit,
  selectedIds,
  onToggleSelect,
  onDeleteSelected,
  isDeviceConnected,
  syncedContactIds,
  unsyncedContacts,
  neverSynced,
  hasUnsynced,
  lastSyncedRelative,
  onOpenSyncPreview,
}) => {
  const showSyncBanner = isDeviceConnected && contacts.length > 0 && !isEditing;

  const syncTitle =
    neverSynced
      ? 'Sync to wristband'
      : hasUnsynced
        ? 'Wristband out of date'
        : 'Wristband up to date';

  const syncSub =
    neverSynced
      ? `${formatContactCount(contacts.length)} · Never synced`
      : hasUnsynced
        ? `${unsyncedContacts.length} new ${unsyncedContacts.length === 1 ? 'contact' : 'contacts'} not yet synced`
        : `Last synced ${lastSyncedRelative}`;

  const syncState = neverSynced ? 'never' : hasUnsynced ? 'delta' : 'upToDate';

  const Banner = () => {
    if (!showSyncBanner) return null;

    if (syncState === 'never') {
      return (
        <TouchableOpacity
          style={styles.syncBannerNever}
          onPress={onOpenSyncPreview}
          activeOpacity={0.85}
        >
          <View style={styles.syncBannerLeft}>
            <MaterialCommunityIcons name="refresh" size={20} color="#3898FC" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.syncBannerTitleBlue}>{syncTitle}</Text>
              <Text style={styles.syncBannerSubBlue}>{syncSub}</Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#3898FC" />
        </TouchableOpacity>
      );
    }

    if (syncState === 'delta') {
      return (
        <TouchableOpacity
          style={styles.syncBannerDelta}
          onPress={onOpenSyncPreview}
          activeOpacity={0.85}
        >
          <View style={styles.syncBannerLeft}>
            <MaterialCommunityIcons name="sync" size={20} color="#F59E0B" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.syncBannerTitleAmber}>{syncTitle}</Text>
              <Text style={styles.syncBannerSubAmber}>{syncSub}</Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#F59E0B" />
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.syncBannerUpToDate}>
        <View style={styles.syncBannerLeft}>
          <MaterialCommunityIcons name="check" size={20} color="#4CAF50" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.syncBannerTitleGreen}>{syncTitle}</Text>
            <Text style={styles.syncBannerSubGreen}>{syncSub}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screenInner}>
      <View style={styles.contactsHeaderRow}>
        <View>
          <Text style={styles.title}>Contacts</Text>
          <Text style={styles.subtitle}>People who receive alerts.</Text>
        </View>
        {contacts.length > 0 && (
          <TouchableOpacity onPress={onToggleEdit}>
            <Text style={styles.editButtonText}>{isEditing ? 'Done' : 'Edit'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <Banner />

      {contacts.length === 0 ? (
        <View style={styles.emptyContacts}>
          <Text style={styles.emptyTitle}>There are currently no emergency contacts added.</Text>
          <Text style={styles.emptyBody}>
            Please add contacts you want to alert when you are in danger.
          </Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          style={{ marginTop: 20 }}
          renderItem={({ item }) => {
            const isSelected = selectedIds.includes(item.id);
            return (
              <TouchableOpacity
                onPress={() => (isEditing ? onToggleSelect(item.id) : null)}
                activeOpacity={isEditing ? 0.8 : 1}
              >
                <View
                  style={[
                    styles.contactCard,
                    isEditing && isSelected && styles.contactCardSelected,
                  ]}
                >
                  <View>
                    <Text style={styles.contactName}>{item.name}</Text>
                    <Text style={styles.contactPhone}>{formatPhoneForDisplay(item.phone)}</Text>
                  </View>
                  {isEditing && (
                    <MaterialCommunityIcons
                      name={isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={22}
                      color={isSelected ? '#3898FC' : '#CCC'}
                    />
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {isEditing ? (
        <TouchableOpacity
          style={[
            styles.addButton,
            styles.deleteButton,
            selectedIds.length === 0 && styles.deleteButtonDisabled,
          ]}
          onPress={onDeleteSelected}
          disabled={selectedIds.length === 0}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={22} color="#FFF" />
          <Text style={styles.addButtonText}>Delete</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
          <MaterialCommunityIcons name="plus" size={24} color="white" />
          <Text style={styles.addButtonText}>Add Contact</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// --- CONTACTS SYNC: Preview Screen ---
const ContactsSyncPreviewScreen = ({
  contacts,
  unsyncedContacts,
  syncedContacts,
  neverSynced,
  onBack,
  onStartSync,
}) => {
  const title = neverSynced ? 'Ready to sync' : "What's changing";
  const subtitle = neverSynced
    ? 'These contacts will be sent to your Sahey Band.'
    : 'Only new contacts will be added — existing ones stay untouched.';

  const deltaCount = unsyncedContacts.length;
  const ctaText = neverSynced
    ? `Sync ${contacts.length} ${contacts.length === 1 ? 'contact' : 'contacts'}`
    : `Sync ${deltaCount} new ${deltaCount === 1 ? 'contact' : 'contacts'}`;

  const RowCard = ({ item, badgeText, badgeColorStyle, cardStyle }) => (
    <View style={[styles.syncPreviewCardBase, cardStyle]}>
      <View>
        <Text style={styles.contactName}>{item.name}</Text>
        <Text style={styles.contactPhone}>{formatPhoneForDisplay(item.phone)}</Text>
      </View>
      <View style={styles.syncPreviewBadgeWrap}>
        <Text style={[styles.syncPreviewBadgeBase, badgeColorStyle]}>{badgeText}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.screenInner}>
      <View style={styles.syncPreviewHeaderRow}>
        <TouchableOpacity onPress={onBack} hitSlop={12} activeOpacity={0.8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color="#000" />
        </TouchableOpacity>
      </View>

      <View style={styles.syncPreviewHeader}>
        <Text style={styles.syncPreviewTitle}>{title}</Text>
        <Text style={styles.syncPreviewSubtitle}>{subtitle}</Text>
      </View>

      {neverSynced ? (
        <View style={{ width: '100%', marginTop: 18 }}>
          {contacts.map((c) => (
            <RowCard
              key={c.id}
              item={c}
              badgeText="New"
              badgeColorStyle={styles.syncPreviewBadgeNewText}
              cardStyle={styles.syncPreviewCardNew}
            />
          ))}
        </View>
      ) : (
        <View style={{ width: '100%', marginTop: 18 }}>
          <Text style={styles.syncPreviewSectionLabel}>Adding to wristband</Text>
          {unsyncedContacts.map((c) => (
            <RowCard
              key={c.id}
              item={c}
              badgeText="New"
              badgeColorStyle={styles.syncPreviewBadgeNewText}
              cardStyle={styles.syncPreviewCardNew}
            />
          ))}

          <Text style={[styles.syncPreviewSectionLabel, { marginTop: 10 }]}>
            Already on wristband
          </Text>
          {syncedContacts.map((c) => (
            <RowCard
              key={c.id}
              item={c}
              badgeText="Synced"
              badgeColorStyle={styles.syncPreviewBadgeSyncedText}
              cardStyle={styles.syncPreviewCardSynced}
            />
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.syncPreviewCtaBtn} onPress={onStartSync} activeOpacity={0.9}>
        <Text style={styles.syncPreviewCtaText}>{ctaText}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.syncPreviewGhostBtn} onPress={onBack} activeOpacity={0.8}>
        <Text style={styles.syncPreviewGhostBtnText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
};

// --- CONTACTS SYNC: Execution Screen ---
const ContactsSyncExecutionScreen = ({
  connectedDeviceId,
  isDeviceConnected,
  bleManager,
  contacts,
  unsyncedContacts,
  syncedContacts,
  neverSynced,
  onCancel,
  onSuccess,
}) => {
  const totalUnsynced = unsyncedContacts.length;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const progressRotating = useRef(null);

  const [isRunning, setIsRunning] = useState(true);
  const [syncError, setSyncError] = useState(null);
  const [stepText, setStepText] = useState('checking connection');
  const [percent, setPercent] = useState(0);

  const [rowStatus, setRowStatus] = useState(() => {
    const initial = {};
    for (const c of unsyncedContacts) initial[c.id] = 'pending';
    return initial;
  });
  const rowStatusRef = useRef(rowStatus);
  useEffect(() => {
    rowStatusRef.current = rowStatus;
  }, [rowStatus]);

  const runSync = useCallback(async () => {
    if (!bleManager || !connectedDeviceId || !isDeviceConnected) {
      setSyncError('No device connected. Please reconnect your wristband.');
      setIsRunning(false);
      return;
    }
    if (unsyncedContacts.length === 0) {
      onSuccess();
      return;
    }

    setSyncError(null);
    setIsRunning(true);

    // Convert failed → pending on retry; keep done.
    const next = { ...rowStatusRef.current };
    for (const c of unsyncedContacts) {
      if (next[c.id] === 'failed') next[c.id] = 'pending';
    }
    setRowStatus(next);

    const confirmedCount = unsyncedContacts.filter((c) => next[c.id] === 'done').length;
    const startPercent = totalUnsynced === 0 ? 0 : Math.round((confirmedCount / totalUnsynced) * 100);
    setPercent(startPercent);
    progressAnim.setValue(totalUnsynced === 0 ? 0 : confirmedCount / totalUnsynced);

    const startRotation = () => {
      rotationAnim.setValue(0);
      progressRotating.current = Animated.loop(
        Animated.timing(rotationAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        })
      );
      progressRotating.current.start();
    };
    const stopRotation = () => {
      try {
        progressRotating.current?.stop();
      } catch (_) {
        // ignore
      }
    };

    startRotation();

    let currentContact = null;

    const unsyncedIdSet = new Set(unsyncedContacts.map((c) => c.id));
    const sendContacts = contacts;

    try {
      setStepText('discovering services');
      await bleManager.discoverAllServicesAndCharacteristicsForDevice(connectedDeviceId);

      const write = async (value) => {
        const b64 = toBase64(value);
        try {
          await bleManager.writeCharacteristicWithResponseForDevice(
            connectedDeviceId,
            CONTACTS_SERVICE_UUID,
            CONTACTS_CHAR_UUID,
            b64,
          );
        } catch (firstErr) {
          await bleManager.writeCharacteristicWithoutResponseForDevice(
            connectedDeviceId,
            CONTACTS_SERVICE_UUID,
            CONTACTS_CHAR_UUID,
            b64,
          );
        }
      };

      setStepText('writing START');
      await write(`START:${sendContacts.length}`);
      let completedUnsyncedCount = confirmedCount;
      for (let i = 0; i < sendContacts.length; i++) {
        const c = sendContacts[i];
        currentContact = c;
        const markDone = unsyncedIdSet.has(c.id) && next[c.id] !== 'done';

        if (markDone) {
          setStepText(`sending ${c.name}`);
          setRowStatus((prev) => ({ ...prev, [c.id]: 'sending' }));
        }

        const digits = String(c.phone).replace(/\D/g, '');
        await write(`${c.name}|${digits}`);

        if (markDone) {
          setRowStatus((prev) => ({ ...prev, [c.id]: 'done' }));
          completedUnsyncedCount += 1;
          const p = totalUnsynced === 0 ? 100 : Math.round((completedUnsyncedCount / totalUnsynced) * 100);
          setPercent(p);
          Animated.timing(progressAnim, {
            toValue: totalUnsynced === 0 ? 1 : completedUnsyncedCount / totalUnsynced,
            duration: 280,
            useNativeDriver: true,
          }).start();
        }
      }

      setStepText('writing END');
      await write('END');

      stopRotation();
      setIsRunning(false);
      onSuccess();
    } catch (e) {
      stopRotation();
      progressAnim.stopAnimation();

      setIsRunning(false);
      const failed =
        currentContact && unsyncedIdSet.has(currentContact.id)
          ? currentContact
          : unsyncedContacts[0];
      const failedName = failed?.name || 'contact';
      setRowStatus((prev) => ({ ...prev, [failed.id]: 'failed' }));

      setSyncError(`Failed sending ${failedName}. Check your wristband is still in range.`);
    }
  }, [
    bleManager,
    connectedDeviceId,
    isDeviceConnected,
    contacts,
    onSuccess,
    progressAnim,
    rotationAnim,
    totalUnsynced,
    unsyncedContacts,
  ]);

  useEffect(() => {
    runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iconRotation = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const isNoDeviceConnectedError = syncError?.startsWith('No device connected');

  return (
    <View style={styles.screenInner}>
      <View style={styles.syncExecHeaderRow}>
        {!isRunning && syncError ? (
          <TouchableOpacity onPress={onCancel} hitSlop={12} activeOpacity={0.8}>
            <MaterialCommunityIcons name="chevron-left" size={28} color="#000" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      <View style={styles.syncExecTop}>
        <View style={styles.syncExecIconCircle}>
          <Animated.View style={{ transform: [{ rotate: iconRotation }] }}>
            <MaterialCommunityIcons name="sync" size={34} color="#3898FC" />
          </Animated.View>
        </View>
        <Text style={styles.syncExecTitle}>Syncing contacts…</Text>
        <Text style={styles.syncExecSubtitle}>Sending to Sahey Band</Text>

        <View style={styles.syncExecProgressBarTrack}>
          <Animated.View
            style={[
              styles.syncExecProgressBarFill,
              { transform: [{ scaleX: progressAnim }] },
            ]}
          />
        </View>

        <View style={styles.syncExecProgressLabelRow}>
          <Text style={styles.syncExecStepText}>{stepText}</Text>
          <Text style={styles.syncExecPercentText}>{percent}%</Text>
        </View>
      </View>

      {unsyncedContacts.length === 0 && !syncError ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.syncExecErrorText}>No contacts to sync.</Text>
        </View>
      ) : (
        <View style={{ width: '100%', marginTop: 16 }}>
          {!neverSynced && (
            <>
              <Text style={styles.syncExecSectionLabel}>Already on wristband</Text>
              {syncedContacts.map((c) => (
                <View key={c.id} style={[styles.syncExecRow, styles.syncExecRowGrey]}>
                  <View>
                    <Text style={styles.syncExecRowName}>{c.name}</Text>
                    <Text style={styles.syncExecRowPhone}>{formatPhoneForDisplay(c.phone)}</Text>
                  </View>
                  <Text style={styles.syncExecDashIcon}>—</Text>
                </View>
              ))}
            </>
          )}

          <Text style={[styles.syncExecSectionLabel, { marginTop: neverSynced ? 0 : 12 }]}>
            Sending now
          </Text>
          {unsyncedContacts.map((c) => {
            const st = rowStatus[c.id] || 'pending';
            return (
              <View key={c.id} style={[styles.syncExecRow, st === 'failed' ? styles.syncExecRowFailed : null]}>
                <View>
                  <Text style={styles.syncExecRowName}>{c.name}</Text>
                  <Text style={styles.syncExecRowPhone}>{formatPhoneForDisplay(c.phone)}</Text>
                </View>
                <View style={styles.syncExecIconRight}>
                  {st === 'pending' ? (
                    <View style={styles.syncExecDot} />
                  ) : st === 'sending' ? (
                    <ActivityIndicator size="small" color="#3898FC" />
                  ) : st === 'done' ? (
                    <MaterialCommunityIcons name="check" size={18} color="#4CAF50" />
                  ) : st === 'failed' ? (
                    <Text style={styles.syncExecFailedX}>✕</Text>
                  ) : (
                    <View style={styles.syncExecDot} />
                  )}
                </View>
              </View>
            );
          })}

          {syncError ? (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.syncExecErrorText}>{syncError}</Text>
            </View>
          ) : null}
        </View>
      )}

      {syncError ? (
        <View style={{ marginTop: 16, width: '100%' }}>
          {!isNoDeviceConnectedError ? (
            <TouchableOpacity style={styles.syncExecTryAgainBtn} onPress={runSync} activeOpacity={0.9}>
              <Text style={styles.syncExecTryAgainText}>Try again</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.syncExecCancelGhostBtn} onPress={onCancel} activeOpacity={0.8}>
            <Text style={styles.syncExecCancelGhostText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

// --- CONTACTS SYNC: Success Screen ---
const ContactsSyncSuccessScreen = ({ contacts, syncRunMeta, lastSyncedRelative, onDone }) => {
  const mode = syncRunMeta?.mode || 'delta';
  const addedCount = syncRunMeta?.addedCount ?? contacts.length;
  const n = contacts.length;

  const title = mode === 'delta' ? 'Wristband updated!' : 'Contacts synced!';
  const subtitle =
    mode === 'delta'
      ? `${addedCount} new ${addedCount === 1 ? 'contact' : 'contacts'} added to your Sahey Band.`
      : `All ${n} ${n === 1 ? 'contact' : 'contacts'} sent to your Sahey Band.`;

  const checkAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(checkAnim, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [checkAnim]);

  const checkScale = checkAnim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const checkOpacity = checkAnim;

  return (
    <View style={styles.screenInner}>
      <View style={styles.syncSuccessTop}>
        <View style={styles.syncSuccessCircle}>
          <Animated.View style={{ transform: [{ scale: checkScale }], opacity: checkOpacity }}>
            <MaterialCommunityIcons name="check-bold" size={44} color="#16A34A" />
          </Animated.View>
        </View>
        <Text style={styles.syncSuccessTitle}>{title}</Text>
        <Text style={styles.syncSuccessSubtitle}>{subtitle}</Text>
      </View>

      <View style={styles.syncSuccessSummaryCard}>
        {contacts.map((c) => (
          <View key={c.id} style={styles.syncSuccessSummaryRow}>
            <MaterialCommunityIcons name="check" size={18} color="#16A34A" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.syncSuccessSummaryName}>{c.name}</Text>
              <Text style={styles.syncSuccessSummaryPhone}>{formatPhoneForDisplay(c.phone)}</Text>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.wideBlackButton, { marginTop: 18, width: '100%' }]}
        onPress={onDone}
        activeOpacity={0.9}
      >
        <Text style={styles.wideBlackButtonText}>Done</Text>
      </TouchableOpacity>

      <Text style={styles.syncSuccessTimestamp}>
        Last synced {lastSyncedRelative} · Sahey Band
      </Text>
    </View>
  );
};

const CommandsScreen = ({ commands, onToggleCommand, onUpdatePhrase }) => (
  <View style={styles.screenInner}>
    <View style={styles.contactsHeaderRow}>
      <View>
        <Text style={styles.title}>Device Settings</Text>
        <Text style={styles.subtitle}>Voice Commands</Text>
      </View>
    </View>

    <FlatList
      data={commands}
      keyExtractor={(item) => item.id}
      style={{ marginTop: 25 }}
      renderItem={({ item }) => (
        <View style={styles.commandCard}>
          <View style={styles.iconCircle}>
             <MaterialCommunityIcons name="microphone-outline" size={20} color="#3898FC" />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <TextInput
              style={styles.commandInput}
              value={item.phrase}
              onChangeText={(text) => onUpdatePhrase(item.id, text)}
              placeholder="Trigger phrase"
            />
            <Text style={styles.commandSubText}>
              {item.id === '1' ? '↳ Call Mom' : item.id === '2' ? '↳ Send emergency alert' : '↳ Call Partner'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => onToggleCommand(item.id)}>
            <MaterialCommunityIcons 
              name={item.enabled ? "toggle-switch" : "toggle-switch-off"} 
              size={48} 
              color={item.enabled ? "#3898FC" : "#999"} 
            />
          </TouchableOpacity>
        </View>
      )}
    />
  </View>
);

/** Three staggered ripple rings + Bluetooth icon (scanning). */
function ScanRippleRings() {
  const a0 = useRef(new Animated.Value(0)).current;
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const ringLoop = (anim, delayMs) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(anim, { toValue: 1, duration: 2200, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const l0 = ringLoop(a0, 0);
    const l1 = ringLoop(a1, 450);
    const l2 = ringLoop(a2, 900);
    l0.start();
    l1.start();
    l2.start();
    return () => {
      l0.stop();
      l1.stop();
      l2.stop();
    };
  }, [a0, a1, a2]);

  const ring = (anim) => {
    const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.35] });
    const opacity = anim.interpolate({
      inputRange: [0, 0.25, 1],
      outputRange: [0.45, 0.32, 0],
    });
    return (
      <Animated.View
        style={[
          styles.scanRingBase,
          {
            transform: [{ scale }],
            opacity,
          },
        ]}
      />
    );
  };

  return (
    <View style={styles.scanRingWrap}>
      {ring(a2)}
      {ring(a1)}
      {ring(a0)}
      <MaterialCommunityIcons name="bluetooth" size={52} color="#3898FC" style={styles.scanRingIcon} />
    </View>
  );
}

/** Single faster pulse ring (connecting). */
function ConnectingPulseRing() {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.75] });
  const opacity = a.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0.5, 0.25, 0],
  });
  return (
    <View style={styles.scanRingWrap}>
      <Animated.View
        style={[
          styles.scanRingBase,
          { transform: [{ scale }], opacity },
        ]}
      />
      <MaterialCommunityIcons name="bluetooth" size={52} color="#3898FC" style={styles.scanRingIcon} />
    </View>
  );
}

/** Green circle + check; spring approximates a drawn check (no SVG in project). */
function SuccessCheckmark() {
  const draw = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    draw.setValue(0);
    Animated.spring(draw, {
      toValue: 1,
      friction: 7,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [draw]);
  const scale = draw.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const opacity = draw;
  return (
    <View style={styles.successCheckCircle}>
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <MaterialCommunityIcons name="check-bold" size={46} color="#FFF" />
      </Animated.View>
    </View>
  );
}

// --- DEVICE SEARCH SCREEN ---
const DeviceSearchScreen = ({ onClose, onConnected }) => {
  const [phase, setPhase] = useState(() => (!bleManager ? 'unavailable' : 'scanning'));
  const [scanEpoch, setScanEpoch] = useState(0);
  const [foundDevice, setFoundDevice] = useState(null);

  useEffect(() => {
    if (!bleManager) return;
    if (phase !== 'scanning') return;

    let cancelled = false;
    let timeoutId = null;

    const onScan = (scanError, device) => {
      if (cancelled) return;
      if (scanError) {
        Alert.alert('Scan error', scanError.message || 'Could not scan for devices.');
        return;
      }
      if (!device) return;
      if (!deviceNameMatchesSahey(device)) return;
      bleManager.stopDeviceScan();
      const name = device.name || device.localName || 'Sahey Band';
      const rssi = typeof device.rssi === 'number' ? device.rssi : null;
      setFoundDevice({ id: device.id, name, rssi });
      setPhase('found');
    };

    bleManager.startDeviceScan(null, { allowDuplicates: false }, onScan);

    timeoutId = setTimeout(() => {
      if (cancelled) return;
      bleManager.stopDeviceScan();
      setPhase((p) => (p === 'scanning' ? 'notfound' : p));
    }, 15000);

    return () => {
      cancelled = true;
      bleManager.stopDeviceScan();
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [phase, scanEpoch]);

  const handleConnectToBand = useCallback(async () => {
    if (!bleManager || !foundDevice) return;
    setPhase('connecting');
    try {
      const device = await bleManager.connectToDevice(foundDevice.id, { requestMTU: 256 });
      await device.discoverAllServicesAndCharacteristics();
      const nm = device.name || device.localName || foundDevice.name || 'Sahey Band';
      if (onConnected) onConnected(device.id, nm);
      setFoundDevice((prev) => (prev ? { ...prev, name: nm } : prev));
      setPhase('success');
    } catch (e) {
      Alert.alert('Connection failed', e?.message || 'Could not connect to your Sahey Band.');
      setPhase('found');
    }
  }, [foundDevice, onConnected]);

  const handleNotMyDevice = useCallback(() => {
    setFoundDevice(null);
    setPhase('scanning');
    setScanEpoch((k) => k + 1);
  }, []);

  const handleTryScanAgain = useCallback(() => {
    setPhase('scanning');
    setScanEpoch((k) => k + 1);
  }, []);

  const showBack = phase !== 'connecting' && phase !== 'success';

  if (phase === 'unavailable') {
    return (
      <View style={styles.screenInner}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <MaterialCommunityIcons name="chevron-left" size={28} color="#000" />
          </TouchableOpacity>
        </View>
        <View style={styles.scanBody}>
          <Text style={styles.emptyBody}>{bleNativeModuleError || 'Bluetooth is not available.'}</Text>
        </View>
      </View>
    );
  }

  const sig = foundDevice ? signalLabel(foundDevice.rssi) : 'Strong signal';

  return (
    <View style={styles.screenInner}>
      <View style={styles.headerRow}>
        {showBack ? (
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <MaterialCommunityIcons name="chevron-left" size={28} color="#000" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      <View style={styles.scanBody}>
        {phase === 'scanning' && (
          <>
            <ScanRippleRings />
            <Text style={styles.scanTitleBlue}>Searching for your wristband…</Text>
            <Text style={styles.scanSubtitleGrey}>Make sure it&apos;s powered on and nearby.</Text>
          </>
        )}

        {phase === 'notfound' && (
          <>
            <View style={styles.notFoundGreyCircle}>
              <MaterialCommunityIcons name="bluetooth-off" size={44} color="#9CA3AF" />
            </View>
            <Text style={styles.notFoundTitle}>Couldn&apos;t find your wristband</Text>
            <Text style={styles.scanSubtitleGrey}>
              Make sure your Sahey Band is charged, switched on, and within range.
            </Text>
            <TouchableOpacity
              style={[styles.wideBlackButton, styles.fullWidthBtn, styles.notFoundTryAgainBtn]}
              onPress={handleTryScanAgain}
              activeOpacity={0.85}
            >
              <Text style={styles.wideBlackButtonText}>Try again</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'found' && foundDevice && (
          <>
            <Text style={[styles.searchTitle, styles.foundTitleSpacing]}>Your wristband was found!</Text>
            <Text style={[styles.scanSubtitleGrey, styles.foundSubtitleSpacing]}>
              We detected your Sahey device nearby and it&apos;s ready to pair.
            </Text>
            <View style={[styles.deviceCard, styles.foundDeviceCard]}>
              <View style={styles.iconCircle}>
                <MaterialCommunityIcons name="watch-variant" size={22} color="#3898FC" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.deviceName}>{foundDevice.name}</Text>
                <Text style={styles.deviceRssi}>
                  Ready to connect · {sig}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.connectButton, styles.fullWidthBtn, styles.foundContinueButton]}
              onPress={handleConnectToBand}
              activeOpacity={0.85}
            >
              <Text style={styles.connectButtonTextOnly}>Continue connecting</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ghostButton, styles.fullWidthBtn, styles.foundGhostButton]}
              onPress={handleNotMyDevice}
              activeOpacity={0.75}
            >
              <Text style={styles.ghostButtonText}>Not my device</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'connecting' && (
          <>
            <ConnectingPulseRing />
            <Text style={styles.searchTitle}>Connecting…</Text>
            <Text style={styles.scanSubtitleGrey}>
              Establishing a secure connection to your Sahey Band.
            </Text>
          </>
        )}

        {phase === 'success' && foundDevice && (
          <>
            <SuccessCheckmark />
            <Text style={styles.searchTitle}>Connected!</Text>
            <Text style={styles.scanSubtitleGrey}>Your wristband is ready to use.</Text>
            <View style={styles.successSummaryCard}>
              <View style={styles.iconCircle}>
                <MaterialCommunityIcons name="watch-variant" size={22} color="#16A34A" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.successSummaryName}>{foundDevice.name}</Text>
                <Text style={styles.successSummaryMeta}>Connected · {sig}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.wideBlackButton, styles.fullWidthBtn]}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={styles.wideBlackButtonText}>Done</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  content: { flex: 1 },
  screenInner: { padding: 25, flex: 1 }, // Removed top padding as SafeAreaView handles it now
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  subtitle: { color: '#888', fontSize: 16 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50', marginRight: 6 },
  pulseDotOff: { backgroundColor: '#CCC' },
  pulseDotReconnect: { backgroundColor: '#3898FC' },
  statusText: { color: '#666', fontSize: 14 },
  statusTextOff: { color: '#999' },
  statusTextReconnect: { color: '#3898FC', fontWeight: '600' },
  homeReconnectingBox: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  batteryContainer: { alignItems: 'center' },
  batteryText: { fontSize: 12, fontWeight: 'bold', color: '#4CAF50' },
  imageContainer: {
    position: 'relative',
    alignItems: 'center',
    marginVertical: 40,
    padding: 30,
    backgroundColor: '#FBFBFB',
    borderRadius: 40,
  },
  imageContainerMenuBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 6,
    zIndex: 2,
  },
  connectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F0FDF4',
  },
  connectedPillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A',
    marginRight: 8,
  },
  connectedPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#16A34A',
  },
  deviceSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  deviceSheetBackdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  deviceSheetPanelWrap: {
    width: '100%',
  },
  deviceSheetPanel: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 28,
  },
  deviceSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDE1E6',
    marginBottom: 16,
  },
  deviceSheetSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#888',
    marginBottom: 14,
  },
  deviceSheetDisconnectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  deviceSheetDisconnectTitle: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    fontWeight: '800',
    color: '#B91C1C',
  },
  deviceSheetCancelBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#F1F3F5',
  },
  deviceSheetCancelText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  scanBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 24,
    paddingHorizontal: 8,
  },
  scanRingWrap: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  scanRingBase: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: '#3898FC',
  },
  scanRingIcon: {
    zIndex: 4,
  },
  scanTitleBlue: {
    marginTop: 20,
    fontSize: 20,
    fontWeight: '800',
    color: '#3898FC',
    textAlign: 'center',
  },
  scanSubtitleGrey: {
    marginTop: 10,
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  foundTitleSpacing: {
    marginTop: 4,
    textAlign: 'center',
  },
  foundSubtitleSpacing: {
    marginTop: 8,
    marginBottom: 4,
  },
  foundDeviceCard: {
    width: '100%',
    marginTop: 16,
    marginBottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  foundContinueButton: {
    marginTop: 22,
    justifyContent: 'center',
  },
  foundGhostButton: {
    marginTop: 12,
  },
  connectButtonTextOnly: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 16,
    textAlign: 'center',
  },
  homeConnectButton: {
    marginTop: 20,
    alignSelf: 'center',
  },
  fullWidthBtn: {
    alignSelf: 'stretch',
    width: '100%',
    marginTop: 14,
    justifyContent: 'center',
  },
  ghostButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#E2E5E9',
    alignItems: 'center',
  },
  ghostButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#555',
  },
  successCheckCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successSummaryCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    padding: 18,
    borderRadius: 18,
    marginTop: 20,
    marginBottom: 8,
  },
  successSummaryName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#166534',
  },
  successSummaryMeta: {
    fontSize: 14,
    fontWeight: '600',
    color: '#16A34A',
    marginTop: 4,
  },
  wideBlackButton: {
    backgroundColor: '#000',
    flexDirection: 'row',
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wideBlackButtonText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 16,
  },
  imageLabel: { marginTop: 10, color: '#CCC', fontSize: 11, fontWeight: 'bold' },
  connectInfo: {
    marginTop: 16,
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
  },
  connectedInfo: {
    marginTop: 16,
    fontSize: 14,
    color: '#3898FC',
    textAlign: 'center',
    fontWeight: '600',
  },
  connectedButtons: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  connectButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: '#3898FC',
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 16,
    marginLeft: 8,
  },
  disconnectButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: '#FDECEA',
    flexDirection: 'row',
    alignItems: 'center',
  },
  disconnectButtonText: {
    color: '#E53935',
    fontWeight: '700',
    fontSize: 16,
    marginLeft: 8,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 15 },
  gestureRow: { flexDirection: 'row', justifyContent: 'space-between' },
  gestureBox: { backgroundColor: '#F8F9FA', padding: 20, borderRadius: 20, width: '48%' },
  bold: { fontWeight: 'bold', fontSize: 15, marginTop: 8 },
  sub: { fontSize: 12, color: '#888', marginTop: 2 },
  emptyContacts: {
    marginTop: 24,
    padding: 20,
    borderRadius: 18,
    backgroundColor: '#F8F9FA',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  contactsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editButtonText: {
    color: '#3898FC',
    fontWeight: '700',
    fontSize: 16,
  },
  contactCard: {
    backgroundColor: '#F8F9FA',
    padding: 18,
    borderRadius: 18,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contactCardSelected: {
    borderWidth: 2,
    borderColor: '#3898FC',
  },
  contactName: { fontSize: 18, fontWeight: '700' },
  contactPhone: { color: '#666', fontSize: 14, marginTop: 2 },
  addButton: { backgroundColor: '#000', flexDirection: 'row', padding: 20, borderRadius: 20, justifyContent: 'center', alignItems: 'center', position: 'absolute', bottom: 20, left: 25, right: 25 },
  addButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16, marginLeft: 8 },
  deleteButton: {
    backgroundColor: '#E53935',
  },
  deleteButtonDisabled: {
    backgroundColor: '#F2A19F',
  },
  deviceCard: {
    backgroundColor: '#F8F9FA',
    padding: 18,
    borderRadius: 18,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  deviceId: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
    maxWidth: 200,
  },
  deviceRssi: {
    fontSize: 12,
    color: '#3898FC',
    marginTop: 2,
    fontWeight: '600',
  },
  rescanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'center',
  },
  rescanButtonText: {
    marginLeft: 8,
    fontSize: 15,
    fontWeight: '700',
    color: '#3898FC',
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchingText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#555',
  },
  connectedBadge: {
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#E3F2FD',
    color: '#1E88E5',
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    color: '#c00',
    fontSize: 14,
    marginBottom: 6,
  },
  errorBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FDECEA',
  },
  errorHint: {
    fontSize: 13,
    color: '#555',
  },
  searchHeader: {
    marginTop: 16,
    alignItems: 'center',
  },
  searchTitle: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  notFoundTitle: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
  notFoundGreyCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#E8EAED',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  notFoundTryAgainBtn: {
    marginTop: 8,
  },
  searchSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  filterSection: {
    marginTop: 12,
  },
  nameFilterInput: {
    backgroundColor: '#F1F3F5',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    fontSize: 15,
    color: '#1a1a1a',
  },
  namedOnlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  namedOnlyLabel: {
    fontSize: 14,
    color: '#444',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CCC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#3898FC',
    borderColor: '#3898FC',
  },
  bottomTab: { flexDirection: 'row', height: 75, borderTopWidth: 1, borderColor: '#F0F0F0', paddingBottom: 10, backgroundColor: '#FFF' },
  tabItem: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabText: { fontSize: 11, color: '#BBB', marginTop: 4, fontWeight: '600' },
  tabActive: { color: '#3898FC' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: 'white',
    paddingHorizontal: 30,
    paddingTop: 30,
    // Bottom padding chosen so the Cancel/Save row sits
    // at a similar distance from the bottom as the tab bar (~20pts)
    paddingBottom: 40,
    borderTopLeftRadius: 35,
    borderTopRightRadius: 35,
  },
  modalTitle: { fontSize: 24, fontWeight: '800', marginBottom: 20 },
  pickFromPhoneButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F4FD', padding: 16, borderRadius: 15, marginBottom: 12 },
  pickFromPhoneText: { color: '#3898FC', fontWeight: '700', fontSize: 16, marginLeft: 8 },
  contactsError: { color: '#c00', fontSize: 14, marginBottom: 8 },
  modalDivider: { color: '#999', fontSize: 14, textAlign: 'center', marginBottom: 12 },
  input: { backgroundColor: '#F1F3F5', padding: 18, borderRadius: 15, marginBottom: 15, fontSize: 16 },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 20,
  },
  btn: { padding: 18, borderRadius: 15, width: '47%', alignItems: 'center' },
  btnCancel: { backgroundColor: '#F1F3F5' },
  btnSave: { backgroundColor: '#3898FC' },
  // Add these to your existing styles object
  contactConfigBox: {
    backgroundColor: '#F8F9FA', // Matches your gestureBox and contactCard
    padding: 18,
    borderRadius: 20,           // Matches your gestureBox
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  contactLeftSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF',    // White circle to pop against the light grey background
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    // Optional: add a very subtle shadow to the white circle
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  contactConfigText: {
    fontSize: 16,
    fontWeight: '700',          // Matches your emptyTitle/contactName weight
    color: '#1a1a1a',
  },
  viewLinkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewLinkText: {
    color: '#3898FC',           // Matches your editButtonText/connectButton color
    fontWeight: '700',
    fontSize: 15,
  },
  commandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingRight: 5,
  },
  commandInput: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  commandSubText: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F4FD',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginTop: 16,
  },
  syncBarDisabled: {
    opacity: 0.7,
  },
  syncBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncBarText: {
    marginLeft: 10,
    fontSize: 15,
    fontWeight: '600',
    color: '#3898FC',
  },
  // --- Contacts sync UI (banner + screens) ---
  syncBannerNever: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F4FD',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  syncBannerDelta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  syncBannerUpToDate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDF4',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#BBF7D0',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  syncBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncBannerTitleBlue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  syncBannerSubBlue: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: '600',
    color: '#3B82F6',
  },
  syncBannerTitleAmber: {
    fontSize: 15,
    fontWeight: '700',
    color: '#92400E',
  },
  syncBannerSubAmber: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: '600',
    color: '#B45309',
  },
  syncBannerTitleGreen: {
    fontSize: 15,
    fontWeight: '700',
    color: '#15803D',
  },
  syncBannerSubGreen: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: '600',
    color: '#16A34A',
  },
  // --- Contacts sync preview screen ---
  syncPreviewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  syncPreviewHeader: {
    marginTop: 10,
  },
  syncPreviewTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#000',
  },
  syncPreviewSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    textAlign: 'left',
  },
  syncPreviewCardBase: {
    backgroundColor: '#F8F9FA',
    padding: 18,
    borderRadius: 18,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  syncPreviewCardNew: {
    backgroundColor: '#F0FDF4',
  },
  syncPreviewCardSynced: {
    backgroundColor: '#F8F9FA',
  },
  syncPreviewBadgeWrap: {
    marginLeft: 12,
  },
  syncPreviewBadgeBase: {
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#F0FDF4',
  },
  syncPreviewBadgeNewText: {
    color: '#15803D',
  },
  syncPreviewBadgeSyncedText: {
    color: '#888',
    backgroundColor: '#F8F9FA',
  },
  syncPreviewSectionLabel: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '800',
    color: '#888',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  syncPreviewCtaBtn: {
    marginTop: 18,
    backgroundColor: '#3898FC',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  syncPreviewCtaText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 16,
  },
  syncPreviewGhostBtn: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#F1F3F5',
    width: '100%',
  },
  syncPreviewGhostBtnText: {
    color: '#333',
    fontWeight: '700',
    fontSize: 16,
  },

  // --- Contacts sync execution screen ---
  syncExecHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  syncExecTop: {
    alignItems: 'center',
    marginTop: 8,
  },
  syncExecIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#E8F4FD',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  syncExecTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#000',
    textAlign: 'center',
  },
  syncExecSubtitle: {
    marginTop: 6,
    fontSize: 15,
    color: '#666',
  },
  syncExecProgressBarTrack: {
    marginTop: 16,
    height: 6,
    width: '100%',
    backgroundColor: '#F1F3F5',
    borderRadius: 3,
    overflow: 'hidden',
  },
  syncExecProgressBarFill: {
    height: 6,
    width: '100%',
    backgroundColor: '#3898FC',
    borderRadius: 3,
  },
  syncExecProgressLabelRow: {
    marginTop: 12,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  syncExecStepText: {
    color: '#3898FC',
    fontWeight: '700',
    fontSize: 13,
  },
  syncExecPercentText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
  syncExecSectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#888',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  syncExecRow: {
    backgroundColor: '#F8F9FA',
    padding: 18,
    borderRadius: 18,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  syncExecRowGrey: {
    backgroundColor: '#F8F9FA',
  },
  syncExecRowFailed: {
    backgroundColor: '#FDECEA',
  },
  syncExecRowName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  syncExecRowPhone: {
    fontSize: 13,
    color: '#666',
  },
  syncExecDashIcon: {
    color: '#9CA3AF',
    fontSize: 22,
    fontWeight: '900',
    marginLeft: 12,
  },
  syncExecIconRight: {
    marginLeft: 12,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncExecDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#BDBDBD',
  },
  syncExecFailedX: {
    color: '#E53935',
    fontSize: 20,
    fontWeight: '900',
  },
  syncExecErrorText: {
    color: '#E53935',
    fontSize: 14,
    lineHeight: 20,
  },
  syncExecTryAgainBtn: {
    width: '100%',
    backgroundColor: '#3898FC',
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncExecTryAgainText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 16,
  },
  syncExecCancelGhostBtn: {
    marginTop: 12,
    width: '100%',
    backgroundColor: '#F1F3F5',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncExecCancelGhostText: {
    color: '#333',
    fontWeight: '700',
    fontSize: 16,
  },

  // --- Contacts sync success screen ---
  syncSuccessTop: {
    alignItems: 'center',
    marginTop: 8,
  },
  syncSuccessCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  syncSuccessTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#000',
    textAlign: 'center',
  },
  syncSuccessSubtitle: {
    marginTop: 8,
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
  },
  syncSuccessSummaryCard: {
    width: '100%',
    backgroundColor: '#F0FDF4',
    borderRadius: 20,
    padding: 16,
    marginTop: 18,
  },
  syncSuccessSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  syncSuccessSummaryName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#15803D',
  },
  syncSuccessSummaryPhone: {
    fontSize: 13,
    color: '#166534',
    marginTop: 2,
  },
  syncSuccessTimestamp: {
    marginTop: 12,
    color: '#999',
    fontSize: 12,
    textAlign: 'left',
  },
});