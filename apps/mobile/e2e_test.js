const axios = require('axios');
const crypto = require('./src/utils/crypto');

const API_URL = 'http://localhost:3001/api';

async function runE2E() {
  try {
    console.log('--- Bắt đầu E2E Test ---');

    // 1. Tạo key pairs cho Toi và Ngan
    console.log('1. Đang tạo Key Pair...');
    const toiKeys = crypto.generateKeyPair();
    const nganKeys = crypto.generateKeyPair();

    // 2. Register
    console.log('2. Đăng ký tài khoản...');
    const randomSuffix = Math.floor(Math.random() * 10000);
    const toiUsername = `Toi_${randomSuffix}`;
    const nganUsername = `Ngan_${randomSuffix}`;

    const resToi = await axios.post(`${API_URL}/auth/register`, {
      username: toiUsername,
      email: `${toiUsername}@example.com`,
      password: 'password123',
      public_key: toiKeys.publicKey
    });
    const toiUser = resToi.data.user;

    const resNgan = await axios.post(`${API_URL}/auth/register`, {
      username: nganUsername,
      email: `${nganUsername}@example.com`,
      password: 'password123',
      public_key: nganKeys.publicKey
    });
    const nganUser = resNgan.data.user;

    console.log(`Đã đăng ký Toi (ID: ${toiUser.id}) và Ngan (ID: ${nganUser.id})`);

    // 3. Toi mã hóa 1 bức thư cho Ngan bằng Public Key của Ngan
    console.log('3. Toi đang viết thư và mã hóa...');
    const letterText = "Chào Ngân, đây là lá thư tuyệt mật từ Tôi!";
    const encryptedData = crypto.encryptLetter(letterText, nganKeys.publicKey);

    // 4. Gọi POST /api/letters
    console.log('4. Đang gửi thư lên Server...');
    const resSend = await axios.post(`${API_URL}/letters`, {
      sender_id: toiUser.id,
      receiver_id: nganUser.id,
      encrypted_content: encryptedData.encryptedContent,
      encrypted_key: encryptedData.encryptedKey
    });
    console.log('Đã gửi thư! Thư ID:', resSend.data.id);

    // 5. Đóng vai Ngan, gọi GET lấy thư về
    console.log('5. Ngân đang lấy thư về...');
    const resGetLetters = await axios.get(`${API_URL}/letters/${nganUsername}`);
    const letters = resGetLetters.data;
    
    if (letters.length === 0) {
      throw new Error('Ngân không nhận được thư nào.');
    }

    const firstLetter = letters[0];
    console.log(`Ngân nhận được thư từ: ${firstLetter.sender.username}`);

    // 6. Ngân dùng Private Key giải mã
    console.log('6. Ngân đang giải mã...');
    const decryptedText = crypto.decryptLetter(
      firstLetter.encrypted_content, 
      firstLetter.encrypted_key, 
      nganKeys.privateKey
    );

    console.log('=> Nội dung thư sau khi giải mã:');
    console.log(`"${decryptedText}"`);

    console.log('--- Hoàn tất E2E Test ---');

  } catch (error) {
    console.error('Lỗi E2E Test:', error.response?.data || error.message);
  }
}

runE2E();
