const forge = require('node-forge');
let bip39;
try {
  bip39 = require('bip39');
} catch (e) {
  console.warn("Không load được bip39 trên Web, sử dụng mock.");
}

function generateKeyPair() {
  try {
    // Để tránh treo trình duyệt, ta giả lập keypair nếu cần thiết
    // Hoặc thử dùng 512 bit cho siêu nhanh trên môi trường test
    const keys = forge.pki.rsa.generateKeyPair(512);
    const publicKeyPem = forge.pki.publicKeyToPem(keys.publicKey);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    return { publicKey: publicKeyPem, privateKey: privateKeyPem };
  } catch (e) {
    return { publicKey: 'mock-pub', privateKey: 'mock-priv' };
  }
}

function encryptLetter(content, receiverPublicKeyPem) {
  // 1. Tạo AES key (32 bytes) và IV (12 bytes) ngẫu nhiên cho AES-GCM
  const aesKey = forge.random.getBytesSync(32);
  const iv = forge.random.getBytesSync(12);

  // 2. Mã hóa nội dung bằng AES-GCM
  const cipher = forge.cipher.createCipher('AES-GCM', aesKey);
  cipher.start({ iv: iv });
  cipher.update(forge.util.createBuffer(content, 'utf8'));
  cipher.finish();

  const encryptedContent = cipher.output.getBytes();
  const tag = cipher.mode.tag.getBytes();

  // Đóng gói content mã hóa và tag thành dạng base64 cách nhau bằng dấu chấm
  const payload = forge.util.encode64(encryptedContent) + '.' + forge.util.encode64(tag);

  // 3. Mã hóa AES key và IV bằng RSA public key của người nhận
  const publicKey = forge.pki.publicKeyFromPem(receiverPublicKeyPem);
  
  // Ghép aesKey và iv (tổng 44 bytes)
  const keyAndIv = aesKey + iv;
  
  // Mã hóa với RSA-OAEP
  const encryptedKeyRaw = publicKey.encrypt(keyAndIv, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() }
  });
  const encryptedKey = forge.util.encode64(encryptedKeyRaw);

  return {
    encryptedContent: payload,
    encryptedKey: encryptedKey
  };
}

function decryptLetter(encryptedContentObj, encryptedKey, myPrivateKeyPem) {
  // 1. Giải mã AES key và IV bằng RSA private key
  const privateKey = forge.pki.privateKeyFromPem(myPrivateKeyPem);
  const encryptedKeyRaw = forge.util.decode64(encryptedKey);
  
  let keyAndIv;
  try {
    keyAndIv = privateKey.decrypt(encryptedKeyRaw, 'RSA-OAEP', {
      md: forge.md.sha256.create(),
      mgf1: { md: forge.md.sha256.create() }
    });
  } catch (e) {
    throw new Error('Giải mã khóa AES thất bại. Có thể sai private key.');
  }

  // Tách 32 bytes AES key và 12 bytes IV
  const aesKey = keyAndIv.substring(0, 32);
  const iv = keyAndIv.substring(32);

  // 2. Giải mã nội dung bằng AES-GCM
  const [encContentB64, tagB64] = encryptedContentObj.split('.');
  const encContent = forge.util.decode64(encContentB64);
  const tag = forge.util.decode64(tagB64);

  const decipher = forge.cipher.createDecipher('AES-GCM', aesKey);
  decipher.start({
    iv: iv,
    tag: forge.util.createBuffer(tag)
  });
  decipher.update(forge.util.createBuffer(encContent));
  const pass = decipher.finish();

  if (!pass) {
    throw new Error('Xác thực chữ ký nội dung thất bại (AES-GCM tag không khớp).');
  }

  return decipher.output.toString('utf8');
}

function generateMnemonic() {
  if (bip39 && bip39.generateMnemonic) {
    try {
      return bip39.generateMnemonic();
    } catch (e) {}
  }
  const mockWords = "abandon ability able about above absent absorb abstract absurd abuse access accident".split(" ");
  return mockWords.join(" ");
}

function encryptPrivateKey(privateKeyPem, mnemonic) {
  let aesKey;
  if (bip39 && bip39.mnemonicToSeedSync) {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    aesKey = seed.slice(0, 32).toString('binary');
  } else {
    // Mock seed cho Web
    const md = forge.md.sha256.create();
    md.update(mnemonic);
    aesKey = md.digest().getBytes().substring(0, 32);
  }
  const iv = forge.random.getBytesSync(12);
  
  const cipher = forge.cipher.createCipher('AES-GCM', aesKey);
  cipher.start({ iv: iv });
  cipher.update(forge.util.createBuffer(privateKeyPem, 'utf8'));
  cipher.finish();
  
  const encrypted = cipher.output.getBytes();
  const tag = cipher.mode.tag.getBytes();
  
  return forge.util.encode64(iv) + '.' + forge.util.encode64(encrypted) + '.' + forge.util.encode64(tag);
}

function decryptPrivateKey(encryptedPayload, mnemonic) {
  let aesKey;
  if (bip39 && bip39.mnemonicToSeedSync) {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    aesKey = seed.slice(0, 32).toString('binary');
  } else {
    const md = forge.md.sha256.create();
    md.update(mnemonic);
    aesKey = md.digest().getBytes().substring(0, 32);
  }
  
  const [ivB64, encB64, tagB64] = encryptedPayload.split('.');
  const iv = forge.util.decode64(ivB64);
  const enc = forge.util.decode64(encB64);
  const tag = forge.util.decode64(tagB64);
  
  const decipher = forge.cipher.createDecipher('AES-GCM', aesKey);
  decipher.start({
    iv: iv,
    tag: forge.util.createBuffer(tag)
  });
  decipher.update(forge.util.createBuffer(enc));
  const pass = decipher.finish();
  
  if (!pass) throw new Error("Sai mnemonic hoặc dữ liệu bị hỏng");
  return decipher.output.toString('utf8');
}

module.exports = {
  generateKeyPair,
  encryptLetter,
  decryptLetter,
  generateMnemonic,
  encryptPrivateKey,
  decryptPrivateKey
};
