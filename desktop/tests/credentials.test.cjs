const {test}=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createCredentials,trustedCredentialFrame}=require('../credentials.cjs');
test('credential files hold ciphertext, are replaced atomically, and clear without touching other settings',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'astrosky-credential-'));
 const secret=crypto.randomBytes(32), cipher={isEncryptionAvailable:()=>true,encryptString:v=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',secret,iv);return Buffer.concat([iv,c.update(v),c.final(),c.getAuthTag()]);},decryptString:b=>{const c=crypto.createDecipheriv('aes-256-gcm',secret,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString();}};
 const file=path.join(root,'weather.bin'),store=createCredentials(file,cipher);
 try{
  fs.writeFileSync(path.join(root,'equipment.json'),'preserved');
  const key='QA_ONLY_WEATHER_KEY_085';store.save(key);assert.equal(store.read(),key);assert.equal(fs.readFileSync(file).includes(key),false);
  store.save('QA_ONLY_NEW_KEY_085');assert.equal(createCredentials(file,cipher).read(),'QA_ONLY_NEW_KEY_085');assert.equal(fs.existsSync(file+'.tmp'),false);
  assert.throws(()=>store.save('name@example.com'));assert.equal(store.read(),'QA_ONLY_NEW_KEY_085');
  store.clear();assert.equal(store.read(),null);assert.equal(fs.readFileSync(path.join(root,'equipment.json'),'utf8'),'preserved');
  assert.throws(()=>createCredentials(file,{isEncryptionAvailable:()=>false}).save(key));assert.equal(fs.existsSync(file),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('credential IPC is restricted to this main window at the private app origin',()=>{
 const frame={url:'http://127.0.0.1:43127/'},contents={mainFrame:frame};const event={sender:contents,senderFrame:frame};
 assert.equal(trustedCredentialFrame(event,contents,'http://127.0.0.1:43127'),true);
 assert.equal(trustedCredentialFrame({...event,senderFrame:{url:frame.url}},contents,'http://127.0.0.1:43127'),false);
 assert.equal(trustedCredentialFrame(event,{},'http://127.0.0.1:43127'),false);
 frame.url='https://example.com';assert.equal(trustedCredentialFrame(event,contents,'http://127.0.0.1:43127'),false);
});
