const fs = require('node:fs');
const path = require('node:path');
const validKey = key => typeof key === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(key);
function createCredentials(file, safeStorage) {
  const requireEncryption = () => {
    if (!safeStorage.isEncryptionAvailable()) throw Error('Credential encryption unavailable');
  };
  return {
    read() {
      if (!fs.existsSync(file)) return null;
      requireEncryption();
      const value = safeStorage.decryptString(fs.readFileSync(file));
      if (!validKey(value)) throw Error('Invalid saved credential');
      return value;
    },
    save(value) {
      if (!validKey(value)) throw Error('Invalid credential');
      requireEncryption();
      const bytes = safeStorage.encryptString(value);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', bytes, { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    },
    clear() { for (const item of [file, file + '.tmp']) fs.rmSync(item, { force: true }); },
  };
}
function trustedCredentialFrame(event, contents, origin) {
  try { return !!contents && event.sender === contents && event.senderFrame === contents.mainFrame &&
    new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}
module.exports = { createCredentials, trustedCredentialFrame };
