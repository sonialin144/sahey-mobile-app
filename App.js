import React, { useState } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, 
  FlatList, Modal, TextInput, KeyboardAvoidingView, Platform 
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
// 1. Import the new Safe Area tools
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export default function App() {
  const [currentTab, setCurrentTab] = useState('home'); 
  const [contacts, setContacts] = useState([
    { id: '1', name: 'Mom', phone: '(555) 123-4567' },
  ]);
  const [modalVisible, setModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const addContact = () => {
    if (newName && newPhone) {
      setContacts([...contacts, { id: Date.now().toString(), name: newName, phone: newPhone }]);
      setNewName('');
      setNewPhone('');
      setModalVisible(false);
    }
  };

  return (
    // 2. Wrap everything in the Provider
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {currentTab === 'home' ? (
            <HomeScreen />
          ) : (
            <ContactsScreen 
              contacts={contacts} 
              setModalVisible={setModalVisible} 
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
        <Modal visible={modalVisible} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContent}>
              <Text style={styles.modalTitle}>Add Contact</Text>
              <TextInput style={styles.input} placeholder="Name" value={newName} onChangeText={setNewName} />
              <TextInput style={styles.input} placeholder="Phone Number" keyboardType="phone-pad" value={newPhone} onChangeText={setNewPhone} />
              <View style={styles.modalButtons}>
                <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => setModalVisible(false)}>
                  <Text>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnSave]} onPress={addContact}>
                  <Text style={{color: 'white', fontWeight: 'bold'}}>Save</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// --- HOME SCREEN ---
const HomeScreen = () => (
  <View style={styles.screenInner}>
    <View style={styles.headerRow}>
      <View>
        <Text style={styles.title}>SAHEY</Text>
        <View style={styles.statusBadge}>
          <View style={styles.pulseDot} />
          <Text style={styles.statusText}>Connected</Text>
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
    </View>

    <Text style={styles.sectionTitle}>Active Gestures</Text>
    <View style={styles.gestureRow}>
      <View style={styles.gestureBox}>
        <MaterialCommunityIcons name="gesture-double-tap" size={24} color="#3898FC" />
        <Text style={styles.bold}>Double Tap</Text>
        <Text style={styles.sub}>SMS Location</Text>
      </View>
      <View style={styles.gestureBox}>
        {/* Fixed icon name here */}
        <MaterialCommunityIcons name="vibrate" size={24} color="#3898FC" />
        <Text style={styles.bold}>Shake x3</Text>
        <Text style={styles.sub}>Call Help</Text>
      </View>
    </View>
  </View>
);

// --- CONTACTS SCREEN ---
const ContactsScreen = ({ contacts, setModalVisible }) => (
  <View style={styles.screenInner}>
    <Text style={styles.title}>Contacts</Text>
    <Text style={styles.subtitle}>People who receive alerts.</Text>
    <FlatList
      data={contacts}
      keyExtractor={item => item.id}
      style={{marginTop: 20}}
      renderItem={({ item }) => (
        <View style={styles.contactCard}>
          <View>
            <Text style={styles.contactName}>{item.name}</Text>
            <Text style={styles.contactPhone}>{item.phone}</Text>
          </View>
          <MaterialCommunityIcons name="check-circle" size={20} color="#4CAF50" />
        </View>
      )}
    />
    <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
      <MaterialCommunityIcons name="plus" size={24} color="white" />
      <Text style={styles.addButtonText}>Add Contact</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  content: { flex: 1 },
  screenInner: { padding: 25, flex: 1 }, // Removed top padding as SafeAreaView handles it now
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  subtitle: { color: '#888', fontSize: 16 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50', marginRight: 6 },
  statusText: { color: '#666', fontSize: 14 },
  batteryContainer: { alignItems: 'center' },
  batteryText: { fontSize: 12, fontWeight: 'bold', color: '#4CAF50' },
  imageContainer: { alignItems: 'center', marginVertical: 40, padding: 30, backgroundColor: '#FBFBFB', borderRadius: 40 },
  imageLabel: { marginTop: 10, color: '#CCC', fontSize: 11, fontWeight: 'bold' },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 15 },
  gestureRow: { flexDirection: 'row', justifyContent: 'space-between' },
  gestureBox: { backgroundColor: '#F8F9FA', padding: 20, borderRadius: 20, width: '48%' },
  bold: { fontWeight: 'bold', fontSize: 15, marginTop: 8 },
  sub: { fontSize: 12, color: '#888', marginTop: 2 },
  contactCard: { backgroundColor: '#F8F9FA', padding: 18, borderRadius: 18, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contactName: { fontSize: 18, fontWeight: '700' },
  contactPhone: { color: '#666', fontSize: 14, marginTop: 2 },
  addButton: { backgroundColor: '#000', flexDirection: 'row', padding: 20, borderRadius: 20, justifyContent: 'center', alignItems: 'center', position: 'absolute', bottom: 20, left: 25, right: 25 },
  addButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16, marginLeft: 8 },
  bottomTab: { flexDirection: 'row', height: 75, borderTopWidth: 1, borderColor: '#F0F0F0', paddingBottom: 10, backgroundColor: '#FFF' },
  tabItem: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabText: { fontSize: 11, color: '#BBB', marginTop: 4, fontWeight: '600' },
  tabActive: { color: '#3898FC' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: 'white', padding: 30, borderTopLeftRadius: 35, borderTopRightRadius: 35 },
  modalTitle: { fontSize: 24, fontWeight: '800', marginBottom: 20 },
  input: { backgroundColor: '#F1F3F5', padding: 18, borderRadius: 15, marginBottom: 15, fontSize: 16 },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  btn: { padding: 18, borderRadius: 15, width: '47%', alignItems: 'center' },
  btnCancel: { backgroundColor: '#F1F3F5' },
  btnSave: { backgroundColor: '#3898FC' }
});