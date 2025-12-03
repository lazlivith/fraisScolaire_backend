const crypto = require("crypto");

const algorithm = "aes-256-cbc";
const ivLength = 16;

// Clé d'encryption par défaut sécurisée (32 caractères exactement)
const DEFAULT_ENCRYPTION_KEY = "a_very_secure_32_byte_secret_key!";

/**
 * Normalize encryption key to exactly 32 bytes
 * @param {string} key - Input key
 * @returns {string} Normalized 32-byte key
 */
const normalizeEncryptionKey = (key) => {
  if (key.length === 32) {
    return key;
  }
  
  if (key.length < 32) {
    return key.padEnd(32, '0');
  }
  
  return key.substring(0, 32);
};

// Get encryption key from environment or use default
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY;
const finalKey = normalizeEncryptionKey(ENCRYPTION_KEY);

const encrypt = (text) => {
  if (text === null || text === undefined || text === "") {
    return text; // Return as is if null, undefined, or empty
  }
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(
    algorithm,
    Buffer.from(finalKey),
    iv
  );
  let encrypted = cipher.update(String(text), "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
};

const decrypt = (text) => {
  if (text === null || text === undefined || text === "") {
    return text; // Return as is if null, undefined, or empty
  }
  // If value is not a string (e.g. seed stored an array/object), don't attempt to split/decrypt.
  if (typeof text !== "string") {
    return text;
  }
  const textParts = text.split(":");
  if (textParts.length !== 2) {
    console.error("Decryption error: Invalid encrypted text format.");
    return null; // Or throw an error, depending on desired behavior
  }
  const iv = Buffer.from(textParts.shift(), "hex");
  const encryptedText = textParts.join(":");
  const decipher = crypto.createDecipheriv(
    algorithm,
    Buffer.from(finalKey),
    iv
  );
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

module.exports = { encrypt, decrypt };
