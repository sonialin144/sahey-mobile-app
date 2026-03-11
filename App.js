import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  PermissionsAndroid,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
// BLE manager is optional (not available in Expo Go)
let BleManagerClass = null;
let bleManager = null;
let bleNativeModuleError =
  'To use Bluetooth device features, create a development build of this app instead of running in Expo Go.';

try {
  // This may fail in Expo Go because react-native-ble-plx is not supported there.
  // eslint-disable-next-line global-require
  BleManagerClass = require('react-native-ble-plx').BleManager;

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

export default function App() {
  const [currentTab, setCurrentTab] = useState('home'); 
  const [contacts, setContacts] = useState([
    { id: '1', name: 'Mom', phone: '(555) 123-4567' },
  ]);
  const [isDeviceConnected, setIsDeviceConnected] = useState(false);
  const [contactsEditing, setContactsEditing] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalInternalVisible, setModalInternalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [contactsError, setContactsError] = useState('');
  const [pickingFromPhone, setPickingFromPhone] = useState(false);
  const modalAnim = useState(new Animated.Value(0))[0];
  const [deviceView, setDeviceView] = useState('main'); // 'main' | 'search'

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

  return (
    // 2. Wrap everything in the Provider
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {currentTab === 'home'
            ? deviceView === 'main'
              ? (
                <HomeScreen
                  onConnectPress={() => setDeviceView('search')}
                  isConnected={isDeviceConnected}
                  onViewContacts={() => setCurrentTab(contacts)}
                  contactCount={contacts.length}
                />
              )
              : (
                <DeviceSearchScreen
                  onClose={() => setDeviceView('main')}
                  onConnected={() => setIsDeviceConnected(true)}
                />
              )
            : (
              <ContactsScreen
                contacts={contacts}
                setModalVisible={setModalVisible}
                isEditing={contactsEditing}
                onToggleEdit={toggleContactsEdit}
                selectedIds={selectedContactIds}
                onToggleSelect={toggleContactSelected}
                onDeleteSelected={deleteSelectedContacts}
              />
            )}
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
          
          <TouchableOpacity style={styles.tabItem} onPress={() => setCurrentTab('contacts')}>
            <MaterialCommunityIcons 
              name="account-group" 
              size={28} 
              color={currentTab === 'contacts' ? '#3898FC' : '#999'} 
            />
            <Text style={[styles.tabText, currentTab === 'contacts' && styles.tabActive]}>Contacts</Text>
          </TouchableOpacity>
        </View>

        {/* Modal for Adding Contacts */}
        <Modal
          visible={modalInternalVisible}
          animationType="none"
          transparent
        >
          <Animated.View
            style={[styles.modalOverlay, { opacity: modalAnim }]}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={{ justifyContent: 'flex-end' }}
            >
              <Animated.View
                style={[
                  styles.modalContent,
                  {
                    transform: [
                      {
                        translateY: modalAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [40, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
              <Text style={styles.modalTitle}>Add Contact</Text>
              {(Platform.OS === 'ios' || Platform.OS === 'android') && (
                <TouchableOpacity
                  style={styles.pickFromPhoneButton}
                  onPress={pickContactFromPhone}
                  disabled={pickingFromPhone}
                >
                  {pickingFromPhone ? (
                    <ActivityIndicator color="#3898FC" />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="account-multiple" size={22} color="#3898FC" />
                      <Text style={styles.pickFromPhoneText}>Pick from phone</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {contactsError ? <Text style={styles.contactsError}>{contactsError}</Text> : null}
              <Text style={styles.modalDivider}>— or add manually —</Text>
              <TextInput style={styles.input} placeholder="Name" value={newName} onChangeText={setNewName} />
              <TextInput style={styles.input} placeholder="Phone Number" keyboardType="phone-pad" value={newPhone} onChangeText={setNewPhone} />
              <View style={styles.modalButtons}>
                <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => { setModalVisible(false); setContactsError(''); }}>
                  <Text>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnSave]} onPress={addContact}>
                  <Text style={{color: 'white', fontWeight: 'bold'}}>Save</Text>
                </TouchableOpacity>
              </View>
              </Animated.View>
            </KeyboardAvoidingView>
          </Animated.View>
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
const HomeScreen = ({ onConnectPress, isConnected, onViewContacts, contactCount }) => (
  <View style={styles.screenInner}>
    <View style={styles.headerRow}>
      <View>
        <Text style={styles.title}>SAHEY</Text>
        <View style={styles.statusBadge}>
          <View
            style={[
              styles.pulseDot,
              !isConnected && styles.pulseDotOff,
            ]}
          />
          <Text
            style={[
              styles.statusText,
              !isConnected && styles.statusTextOff,
            ]}
          >
            {isConnected ? 'Connected' : 'Not connected'}
          </Text>
        </View>
      </View>
      <View style={styles.batteryContainer}>
        <MaterialCommunityIcons name="battery-80" size={24} color="#4CAF50" />
        <Text style={styles.batteryText}>84%</Text>
      </View>
    </View>

    <View style={styles.imageContainer}>
      <MaterialCommunityIcons name="watch-variant" size={140} color="#3898FC" />
      <Text style={styles.imageLabel}>Wristband v1.0.4</Text>
      <Text style={styles.connectInfo}>
        Connect your device to unlock device features!
      </Text>
      <TouchableOpacity style={styles.connectButton} onPress={onConnectPress}>
        <MaterialCommunityIcons name="bluetooth" size={20} color="#FFF" />
        <Text style={styles.connectButtonText}>Connect</Text>
      </TouchableOpacity>
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

// --- CONTACTS SCREEN ---
const ContactsScreen = ({
  contacts,
  setModalVisible,
  isEditing,
  onToggleEdit,
  selectedIds,
  onToggleSelect,
  onDeleteSelected,
}) => (
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

    {contacts.length === 0 ? (
      <View style={styles.emptyContacts}>
        <Text style={styles.emptyTitle}>
          There are currently no emergency contacts added.
        </Text>
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
                  <Text style={styles.contactPhone}>
                    {formatPhoneForDisplay(item.phone)}
                  </Text>
                </View>
                {isEditing && (
                  <MaterialCommunityIcons
                    name={
                      isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'
                    }
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
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => setModalVisible(true)}
      >
        <MaterialCommunityIcons name="plus" size={24} color="white" />
        <Text style={styles.addButtonText}>Add Contact</Text>
      </TouchableOpacity>
    )}
  </View>
);

// Short ID for BLE device (id is often UUID or MAC) so "Unknown" entries are distinguishable
const shortDeviceId = (id) => {
  if (!id) return '';
  const s = String(id).trim();
  if (s.includes(':')) {
    const parts = s.split(':');
    return parts.slice(-3).join(':').toUpperCase();
  }
  return s.length > 6 ? s.slice(-6).toUpperCase() : s;
};

// --- DEVICE SEARCH SCREEN ---
const DeviceSearchScreen = ({ onClose, onConnected }) => {
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState(bleNativeModuleError || '');
  const [connectingId, setConnectingId] = useState(null);
  const [connectedId, setConnectedId] = useState(null);
  const [namedOnly, setNamedOnly] = useState(false);
  const [nameFilter, setNameFilter] = useState('');

  useEffect(() => {
    if (!bleManager) {
      setScanning(false);
      return;
    }

    let cancelled = false;
    let timeoutId = null;

    const runScan = async () => {
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
        try {
          const result = await PermissionsAndroid.requestMultiple(perms);
          const denied = Object.keys(result).find((k) => result[k] !== PermissionsAndroid.RESULTS.GRANTED);
          if (denied && !cancelled) {
            setError('Bluetooth permission is required to find and connect to your wristband.');
            setScanning(false);
            return;
          }
        } catch (permErr) {
          if (!cancelled) {
            setError(permErr?.message || 'Permission request failed.');
            setScanning(false);
          }
          return;
        }
      }

      if (cancelled) return;

      setScanning(true);
      setError('');
      const seen = new Set();

      bleManager.startDeviceScan(null, null, (scanError, device) => {
        if (cancelled) return;
        if (scanError) {
          setError(scanError.message || 'Error while scanning for devices.');
          setScanning(false);
          return;
        }
        if (!device) return;
        if (seen.has(device.id)) return;
        seen.add(device.id);
        const hasName = !!(device.name || device.localName);
        const displayName = hasName
          ? (device.name || device.localName)
          : `Unknown device (${shortDeviceId(device.id)})`;
        setDevices((prev) => [
          ...prev,
          {
            id: device.id,
            name: displayName,
            hasName,
          },
        ]);
      });

      timeoutId = setTimeout(() => {
        if (!cancelled) {
          bleManager.stopDeviceScan();
          setScanning(false);
        }
      }, 10000);
    };

    runScan();

    return () => {
      cancelled = true;
      bleManager.stopDeviceScan();
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, []);

  const handleConnect = async (deviceId) => {
    if (!bleManager) return;
    setError('');
    setConnectingId(deviceId);
    try {
      const device = await bleManager.connectToDevice(deviceId, {
        requestMTU: 256,
      });
      await device.discoverAllServicesAndCharacteristics();
      setConnectedId(deviceId);
      if (onConnected) {
        onConnected();
      }
    } catch (e) {
      setError(e.message || 'Could not connect to device.');
    } finally {
      setConnectingId(null);
    }
  };

  return (
    <View style={styles.screenInner}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onClose}>
          <MaterialCommunityIcons name="chevron-left" size={28} color="#000" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchHeader}>
        <Text style={styles.searchTitle}>Searching for devices…</Text>
        <Text style={styles.searchSubtitle}>
          Make sure your Bluetooth is enabled and your wristband is on. To see your ESP32 by name, set its BLE name in firmware (e.g. BLEDevice::init("Sahey")).
        </Text>
      </View>

      {devices.length > 0 ? (
        <View style={styles.filterSection}>
          <TextInput
            style={styles.nameFilterInput}
            placeholder="Filter by name (e.g. Sahey or ESP32)"
            placeholderTextColor="#999"
            value={nameFilter}
            onChangeText={setNameFilter}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.namedOnlyRow}
            onPress={() => setNamedOnly((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.namedOnlyLabel}>Only show named devices</Text>
            <View style={[styles.checkbox, namedOnly && styles.checkboxChecked]}>
              {namedOnly ? <MaterialCommunityIcons name="check" size={16} color="#FFF" /> : null}
            </View>
          </TouchableOpacity>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        {scanning ? (
          <View style={styles.searchingRow}>
            <ActivityIndicator color="#3898FC" />
            <Text style={styles.searchingText}>Scanning for nearby devices…</Text>
          </View>
        ) : !bleManager ? null : devices.length === 0 ? (
          <Text style={styles.emptyBody}>
            No devices detected yet. Move closer to your wristband and try again.
          </Text>
        ) : null}
      </View>

      <FlatList
        data={(namedOnly ? devices.filter((d) => d.hasName) : devices).filter(
          (d) => !nameFilter.trim() || d.name.toLowerCase().includes(nameFilter.trim().toLowerCase())
        )}
        keyExtractor={(item) => item.id}
        style={{ marginTop: 24 }}
        renderItem={({ item }) => {
          const isConnecting = connectingId === item.id;
          const isConnected = connectedId === item.id;
          return (
            <TouchableOpacity
              onPress={() => handleConnect(item.id)}
              disabled={isConnecting}
              activeOpacity={0.8}
            >
              <View style={styles.deviceCard}>
                <View>
                  <Text style={styles.deviceName}>{item.name}</Text>
                  <Text style={styles.deviceId} numberOfLines={1}>
                    {item.id}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {isConnected && (
                    <Text style={styles.connectedBadge}>Connected</Text>
                  )}
                  {isConnecting ? (
                    <ActivityIndicator color="#3898FC" />
                  ) : (
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={22}
                      color="#888"
                    />
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
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
  statusText: { color: '#666', fontSize: 14 },
  statusTextOff: { color: '#999' },
  batteryContainer: { alignItems: 'center' },
  batteryText: { fontSize: 12, fontWeight: 'bold', color: '#4CAF50' },
  imageContainer: { alignItems: 'center', marginVertical: 40, padding: 30, backgroundColor: '#FBFBFB', borderRadius: 40 },
  imageLabel: { marginTop: 10, color: '#CCC', fontSize: 11, fontWeight: 'bold' },
  connectInfo: {
    marginTop: 16,
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
  },
  connectButton: {
    marginTop: 16,
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
});