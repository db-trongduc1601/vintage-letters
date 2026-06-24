import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Dimensions, Alert, ImageBackground, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay } from 'react-native-reanimated';
import { Audio } from 'expo-av';
import io from 'socket.io-client';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateKeyPair, generateMnemonic, encryptPrivateKey, decryptPrivateKey, encryptLetter } from '../utils/crypto';

const { width } = Dimensions.get('window');

export default function HomeScreen() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  const [receiver, setReceiver] = useState('');
  const [letterContent, setLetterContent] = useState('');
  const [stampImage, setStampImage] = useState<string | null>(null);

  const stampTranslateX = useSharedValue(0);
  const stampTranslateY = useSharedValue(0);
  const stampOffsetX = useSharedValue(0);
  const stampOffsetY = useSharedValue(0);

  const letterScale = useSharedValue(1);
  const letterTranslateY = useSharedValue(0);

  const incomingTranslateY = useSharedValue(-500);

  const syncOfflineLetters = async () => {
    try {
      const state = await NetInfo.fetch();
      if (state.isConnected) {
        const offlineQueue = await AsyncStorage.getItem('offline_letters');
        if (offlineQueue) {
          const letters = JSON.parse(offlineQueue);
          if (letters.length > 0) {
            console.log(`Syncing ${letters.length} offline letters...`);
            // Mock pushing to server
            await AsyncStorage.removeItem('offline_letters');
            Alert.alert("Đồng bộ", `Đã gửi ${letters.length} thư lưu offline khi có mạng.`);
          }
        }
      }
    } catch (e) {
      console.error("Sync error:", e);
    }
  };

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected && isLoggedIn) {
        syncOfflineLetters();
      }
    });
    return () => unsubscribe();
  }, [isLoggedIn]);

  useEffect(() => {
    let socket;
    if (isLoggedIn && username) {
      socket = io('http://localhost:3001', {
        transports: ['websocket'],
      });

      socket.on('connect', () => {
        console.log('Connected to socket server');
        socket.emit('register_socket', username);
      });

      socket.on('new_letter', async (letter) => {
        console.log('New letter received:', letter);
        
        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri: 'https://actions.google.com/sounds/v1/foley/paper_rustle.ogg' }
          );
          await sound.playAsync();
        } catch (error) {
          console.error('Error playing sound:', error);
        }

        incomingTranslateY.value = -500;
        incomingTranslateY.value = withSpring(0, { damping: 5 });
        
        setTimeout(() => {
          incomingTranslateY.value = withSpring(-500);
        }, 5000);
      });
    }

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [isLoggedIn, username]);

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled) {
      setStampImage(result.assets[0].uri);
      stampTranslateX.value = 0;
      stampTranslateY.value = 0;
      stampOffsetX.value = 0;
      stampOffsetY.value = 0;
    }
  };

  const handleRegister = async () => {
    if (!username.trim()) {
      Alert.alert("Lỗi", "Vui lòng nhập Username");
      return;
    }
    try {
      const keys = generateKeyPair();
      const newMnemonic = generateMnemonic();
      const encPrivKey = encryptPrivateKey(keys.privateKey, newMnemonic);
      
      await AsyncStorage.setItem(`user_${username}_encPrivKey`, encPrivKey);
      await AsyncStorage.setItem(`user_${username}_pubKey`, keys.publicKey);
      
      setPrivateKey(keys.privateKey);
      setIsLoggedIn(true);
      
      Alert.alert(
        "Tạo tài khoản thành công", 
        "VUI LÒNG GHI LẠI 12 TỪ SAU ĐỂ KHÔI PHỤC TÀI KHOẢN:\n\n" + newMnemonic,
        [{ text: "Đã chép lại" }]
      );
      console.log(`[Backup Mnemonic for ${username}]: ${newMnemonic}`);
    } catch (e: any) {
      Alert.alert("Lỗi", e.message);
    }
  };

  const handleLogin = async () => {
    if (!username.trim() || !mnemonic.trim()) {
      Alert.alert("Lỗi", "Vui lòng nhập Username và 12 từ khôi phục (Mnemonic) để đăng nhập");
      return;
    }
    try {
      const encPrivKey = await AsyncStorage.getItem(`user_${username}_encPrivKey`);
      if (!encPrivKey) {
        Alert.alert("Lỗi", "Không tìm thấy user trên server (giả lập AsyncStorage)");
        return;
      }
      
      const privKey = decryptPrivateKey(encPrivKey, mnemonic.trim());
      setPrivateKey(privKey);
      setIsLoggedIn(true);
      Alert.alert("Thành công", "Khôi phục khóa thành công và đã đăng nhập!");
    } catch (e: any) {
      Alert.alert("Lỗi giải mã", e.message || "Sai mnemonic");
    }
  };

  const performSend = async () => {
    console.log('Sending letter to:', receiver);
    
    try {
      const state = await NetInfo.fetch();
      
      const letterData = {
        receiver,
        content: letterContent,
        stamp: stampImage,
        timestamp: new Date().toISOString()
      };

      if (state.isConnected) {
        console.log('Online: Thư được gửi trực tiếp (giả lập API)');
        Alert.alert('Thành công', 'Thư đã được gửi lên server!');
      } else {
        const offlineQueue = await AsyncStorage.getItem('offline_letters');
        const letters = offlineQueue ? JSON.parse(offlineQueue) : [];
        letters.push(letterData);
        await AsyncStorage.setItem('offline_letters', JSON.stringify(letters));
        console.log('Offline: Thư đã được lưu vào offline_letters');
        Alert.alert('Mất mạng', 'Đã lưu thư vào hàng đợi. Sẽ gửi tự động khi có mạng.');
      }
    } catch (e) {
      console.error(e);
    }

    setTimeout(() => {
      letterScale.value = withTiming(1, { duration: 300 });
      letterTranslateY.value = withTiming(0, { duration: 300 });
      setLetterContent('');
      setStampImage(null);
      stampTranslateX.value = 0;
      stampTranslateY.value = 0;
      stampOffsetX.value = 0;
      stampOffsetY.value = 0;
    }, 1500);
  };

  const handleSend = () => {
    letterScale.value = withTiming(0.6, { duration: 400 });
    letterTranslateY.value = withDelay(200, withTiming(-800, { duration: 600 }));

    setTimeout(() => {
      performSend();
    }, 500);
  };

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      stampTranslateX.value = stampOffsetX.value + e.translationX;
      stampTranslateY.value = stampOffsetY.value + e.translationY;
    })
    .onEnd(() => {
      const targetX = 120;
      const targetY = -350;
      stampTranslateX.value = withSpring(targetX);
      stampTranslateY.value = withSpring(targetY);
      stampOffsetX.value = targetX;
      stampOffsetY.value = targetY;
    });

  const animatedStampStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: stampTranslateX.value },
        { translateY: stampTranslateY.value },
      ],
      zIndex: 10,
    };
  });

  const animatedLetterStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { scale: letterScale.value },
        { translateY: letterTranslateY.value },
      ],
    };
  });

  const incomingEnvelopeStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: incomingTranslateY.value }
      ]
    };
  });

  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <View style={[styles.loginContainer, styles.loginPaper]}>
          <Text style={styles.title}>Vintage Letters</Text>
          <TextInput
            style={styles.input}
            placeholder="Username của bạn"
            placeholderTextColor="#888"
            value={username}
            onChangeText={setUsername}
          />
          <TextInput
            style={styles.input}
            placeholder="12 từ khôi phục (nếu đăng nhập máy mới)"
            placeholderTextColor="#888"
            value={mnemonic}
            onChangeText={setMnemonic}
            multiline
          />
          <View style={{ marginBottom: 10 }}>
            <TouchableOpacity style={styles.vintageButton} onPress={handleLogin}>
              <Text style={styles.vintageButtonText}>Đăng nhập</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.vintageButtonOutline} onPress={handleRegister}>
            <Text style={styles.vintageButtonOutlineText}>Đăng ký mới</Text>
          </TouchableOpacity>
        </View>
        <View pointerEvents="none" style={styles.noiseOverlay}>
          <Image source={require('../../assets/images/noise.png')} style={styles.noiseImage} />
        </View>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.container}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.header}>
            <Text style={styles.title}>Viết Thư</Text>
            <Text style={styles.subtitle}>Gửi từ: {username}</Text>
          </View>

          <Animated.View style={[styles.letterContainer, animatedLetterStyle]}>
            <TextInput
              style={styles.inputHeader}
              placeholder="Gửi tới (ID hoặc Username)"
              placeholderTextColor="#888"
              value={receiver}
              onChangeText={setReceiver}
            />

            <View style={styles.paperBody}>
              <TextInput
                style={styles.letterInput}
                placeholder="Nội dung thư..."
                placeholderTextColor="#a09a8e"
                multiline
                value={letterContent}
                onChangeText={setLetterContent}
                textAlignVertical="top"
              />

              <View style={styles.stampArea}>
                {stampImage ? (
                  <GestureDetector gesture={panGesture}>
                    <Animated.View style={[styles.stampWrapper, animatedStampStyle]}>
                      <Image source={{ uri: stampImage }} style={styles.stampImage} />
                    </Animated.View>
                  </GestureDetector>
                ) : (
                  <TouchableOpacity onPress={pickImage} style={styles.stampPlaceholder}>
                    <Text style={styles.stampText}>Dán tem</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Animated.View>

          <View style={styles.actionContainer}>
            <TouchableOpacity onPress={handleSend} style={styles.waxSealButton}>
              <Image source={require('../../assets/images/wax_seal.png')} style={styles.waxSealImage} />
              <Text style={styles.waxSealText}>Gửi</Text>
            </TouchableOpacity>
          </View>

          <Animated.View style={[styles.incomingEnvelope, incomingEnvelopeStyle]}>
            <Text style={styles.incomingText}>Bạn có thư mới! ✉️</Text>
          </Animated.View>
        </SafeAreaView>

        <View pointerEvents="none" style={styles.noiseOverlay}>
          <Image source={require('../../assets/images/noise.png')} style={styles.noiseImage} />
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#3e2723', // backup color
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 30,
  },
  loginPaper: {
    backgroundColor: '#FDFBF7',
    margin: 20,
    borderRadius: 8,
    maxHeight: 400,
    maxWidth: 500,
    width: '100%',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  header: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontFamily: 'PlayfairDisplay_700Bold',
    color: '#3e2723',
    marginBottom: 5,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'SpecialElite_400Regular',
    fontSize: 16,
    color: '#5d4037',
  },
  input: {
    fontFamily: 'SpecialElite_400Regular',
    borderBottomWidth: 1,
    borderBottomColor: '#d7ccc8',
    padding: 10,
    marginBottom: 20,
    fontSize: 16,
    color: '#3e2723',
  },
  inputHeader: {
    fontFamily: 'SpecialElite_400Regular',
    borderBottomWidth: 2,
    borderBottomColor: '#8d6e63',
    padding: 15,
    fontSize: 18,
    color: '#3e2723',
  },
  letterContainer: {
    flex: 1,
    zIndex: 1,
    backgroundColor: '#FDFBF7',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 4,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 5, height: 15 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  paperBody: {
    flex: 1,
    position: 'relative',
  },
  letterInput: {
    flex: 1,
    padding: 20,
    paddingTop: 30,
    fontSize: 18,
    lineHeight: 32,
    fontFamily: 'SpecialElite_400Regular',
    color: '#212121',
  },
  stampArea: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
  },
  stampWrapper: {
    padding: 4,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#e0e0e0',
    transform: [{ rotate: '4deg' }],
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  stampImage: {
    width: 70,
    height: 80,
    resizeMode: 'cover',
  },
  stampPlaceholder: {
    width: 80,
    height: 90,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#bcaaa4',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  stampText: {
    fontFamily: 'SpecialElite_400Regular',
    color: '#8d6e63',
    fontSize: 14,
  },
  actionContainer: {
    padding: 10,
    alignItems: 'center',
    zIndex: 0,
  },
  waxSealButton: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 8,
  },
  waxSealImage: {
    width: 100,
    height: 100,
    resizeMode: 'contain',
  },
  waxSealText: {
    position: 'absolute',
    fontFamily: 'PlayfairDisplay_700Bold',
    color: '#fff',
    fontSize: 20,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  vintageButton: {
    backgroundColor: '#5d4037',
    padding: 15,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 10,
  },
  vintageButtonText: {
    color: '#fff',
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 18,
  },
  vintageButtonOutline: {
    borderWidth: 1,
    borderColor: '#5d4037',
    padding: 15,
    borderRadius: 4,
    alignItems: 'center',
  },
  vintageButtonOutlineText: {
    color: '#5d4037',
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 18,
  },
  incomingEnvelope: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: '#FDFBF7',
    padding: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#d7ccc8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
    zIndex: 100,
  },
  incomingText: {
    fontFamily: 'SpecialElite_400Regular',
    fontSize: 18,
    color: '#3e2723',
  },
  noiseOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    opacity: 0.08,
    zIndex: 999,
  },
  noiseImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  }
});
