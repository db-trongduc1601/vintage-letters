import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Dimensions, Alert } from 'react-native';
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
      socket = io('https://fine-olives-relax.loca.lt', {
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
      <SafeAreaView style={styles.container}>
        <View style={styles.loginContainer}>
          <Text style={styles.title}>Vintage Letters</Text>
          <TextInput
            style={styles.input}
            placeholder="Username của bạn"
            value={username}
            onChangeText={setUsername}
          />
          <TextInput
            style={styles.input}
            placeholder="12 từ khôi phục (nếu đăng nhập máy mới)"
            value={mnemonic}
            onChangeText={setMnemonic}
            multiline
          />
          <View style={{ marginBottom: 10 }}>
            <Button title="Đăng nhập (bằng Mnemonic)" onPress={handleLogin} />
          </View>
          <Button title="Đăng ký mới" onPress={handleRegister} color="#8D6E63" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Viết Thư</Text>
          <Text>Gửi từ: {username}</Text>
        </View>

        <Animated.View style={[styles.letterContainer, animatedLetterStyle]}>
          <TextInput
            style={styles.input}
            placeholder="Gửi tới (ID hoặc Username)"
            value={receiver}
            onChangeText={setReceiver}
          />

          <TextInput
            style={styles.letterInput}
            placeholder="Nội dung thư..."
            multiline
            value={letterContent}
            onChangeText={setLetterContent}
            textAlignVertical="top"
          />

          <View style={styles.stampContainer}>
            {stampImage ? (
              <GestureDetector gesture={panGesture}>
                <Animated.Image 
                  source={{ uri: stampImage }} 
                  style={[styles.stampImage, animatedStampStyle]} 
                />
              </GestureDetector>
            ) : (
              <View style={styles.stampPlaceholder}>
                <Text style={styles.stampText}>Chưa có tem</Text>
              </View>
            )}
            <Button title="Chọn tem" onPress={pickImage} />
          </View>
        </Animated.View>

        <View style={styles.actionContainer}>
          <Button title="Gửi thư" onPress={handleSend} color="#4CAF50" />
        </View>

        <Animated.View style={[styles.incomingEnvelope, incomingEnvelopeStyle]}>
          <Text style={styles.incomingText}>Bạn có thư mới! ✉️</Text>
        </Animated.View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FDFBF7',
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  letterContainer: {
    flex: 1,
    zIndex: 1,
  },
  letterInput: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    marginHorizontal: 20,
    padding: 10,
    fontSize: 16,
    lineHeight: 24,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 5,
  },
  stampContainer: {
    alignItems: 'center',
    marginVertical: 20,
    zIndex: 10,
  },
  stampPlaceholder: {
    width: 80,
    height: 80,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#999',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  stampText: {
    color: '#999',
    fontSize: 12,
  },
  stampImage: {
    width: 80,
    height: 80,
    marginBottom: 10,
  },
  actionContainer: {
    padding: 20,
    zIndex: 0,
  },
  incomingEnvelope: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: '#FFF9C4',
    padding: 30,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D4E157',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 100,
  },
  incomingText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  }
});
