const { generateKeyPair, encryptLetter, decryptLetter } = require('./src/utils/crypto');

console.log('⏳ Đang tạo cặp khóa RSA 2048-bit (Sẽ mất một chút thời gian)...');
const keys = generateKeyPair();
console.log('✅ Đã tạo cặp khóa thành công!\n');

const message = "Thư gửi từ quá khứ. Mong rằng cậu vẫn khỏe. Ngày mai trời sẽ lại sáng.";
console.log('--- NỘI DUNG GỐC ---');
console.log(message);
console.log('--------------------\n');

console.log('⏳ Đang mã hóa bức thư...');
const encrypted = encryptLetter(message, keys.publicKey);

console.log('\n--- KẾT QUẢ MÃ HÓA (ĐỐNG RÁC) ---');
console.log('1. Encrypted Content (Bức thư mã hóa + Auth Tag):');
console.log(encrypted.encryptedContent);
console.log('\n2. Encrypted Key (AES Key + IV mã hóa bằng RSA):');
console.log(encrypted.encryptedKey);
console.log('---------------------------------\n');

console.log('⏳ Đang giải mã bức thư...');
const decrypted = decryptLetter(encrypted.encryptedContent, encrypted.encryptedKey, keys.privateKey);

console.log('\n--- KẾT QUẢ GIẢI MÃ ---');
console.log(decrypted);
console.log('-----------------------\n');

if (message === decrypted) {
    console.log('🎉 THÀNH CÔNG: Nội dung giải mã khớp hoàn toàn với nội dung gốc!');
} else {
    console.log('❌ THẤT BẠI: Nội dung giải mã không khớp!');
}
