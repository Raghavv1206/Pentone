import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VERIFICATION_THRESHOLDS,
  type UnencryptedSpeakerProfile,
} from '../lib/audio/speaker-types';
import {
  buildProfileAAD,
  InMemoryStructuredCloneDriver,
  IndexedDBKeyStore,
  IndexedDBProfileStore,
  PersistentProfileVaultManager,
  ProfileVault,
} from '../lib/audio/speaker-profile-vault';

// Helper to create a valid dummy unencrypted speaker profile for testing
function createDummyProfile(userId: string): UnencryptedSpeakerProfile {
  const dummyCentroid = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    dummyCentroid[i] = Math.sin(i * 0.1);
  }

  const dummyExemplar1 = new Float32Array(512);
  const dummyExemplar2 = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    dummyExemplar1[i] = Math.cos(i * 0.1);
    dummyExemplar2[i] = Math.sin(i * 0.2);
  }

  return {
    metadata: {
      schemaVersion: 2,
      modelVersion: 'campplus-en-voxceleb-512-v1',
      userId,
      enrolledAt: 1730370000000,
      lastCalibratedAt: 1730370000000,
      noiseFloorRms: 0.005,
      conversationalSampleCount: 5,
      shortUtteranceSampleCount: 2,
      conversationalMeanSimilarity: 0.82,
      shortMeanSimilarity: 0.79,
      thresholds: DEFAULT_VERIFICATION_THRESHOLDS,
    },
    conversationalCentroid: dummyCentroid,
    conversationalExemplars: [dummyExemplar1, dummyExemplar2],
    shortCommandCentroid: dummyCentroid,
    shortCommandExemplars: [dummyExemplar1],
  };
}

// =================================================================
// 1. Cryptographic Primitives & Non-Extractability Tests
// =================================================================

test('ProfileVault: Generates valid Web Crypto non-extractable AES-256-GCM key handle', async () => {
  const key = await ProfileVault.generateNonExtractableKey();
  assert.equal(key.type, 'secret');
  assert.equal(key.extractable, false, 'CryptoKey MUST be non-extractable (extractable: false)');
  assert.equal(key.algorithm.name, 'AES-GCM');
  // @ts-ignore
  assert.equal(key.algorithm.length, 256);
  assert.deepEqual(key.usages, ['encrypt', 'decrypt']);
});

test('ProfileVault: Rejects serialization / export of raw key material', async () => {
  const key = await ProfileVault.generateNonExtractableKey();
  await assert.rejects(
    async () => await crypto.subtle.exportKey('raw', key),
    /not extractable|operation not allowed/i
  );
});

test('ProfileVault: Profile serialization and deserialization preserves all 512-dim vectors bit-for-bit', () => {
  const profile = createDummyProfile('test-user-serial');
  const bytes = ProfileVault.serializeProfile(profile);
  const deserialized = ProfileVault.deserializeProfile(bytes);

  assert.equal(deserialized.metadata.userId, 'test-user-serial');
  assert.equal(deserialized.metadata.schemaVersion, 2);
  assert.equal(deserialized.conversationalCentroid.length, 512);
  assert.equal(deserialized.shortCommandCentroid.length, 512);
  assert.equal(deserialized.conversationalExemplars.length, 2);
  assert.equal(deserialized.shortCommandExemplars.length, 1);

  // Bit-exact comparison
  for (let i = 0; i < 512; i++) {
    assert.equal(deserialized.conversationalCentroid[i], profile.conversationalCentroid[i]);
    assert.equal(deserialized.shortCommandCentroid[i], profile.shortCommandCentroid[i]);
  }
});

test('ProfileVault: AES-256-GCM encrypts and decrypts with 100% roundtrip fidelity', async () => {
  const key = await ProfileVault.generateNonExtractableKey();
  const profile = createDummyProfile('test-user-enc');

  const pkg = await ProfileVault.encryptProfile(profile, key);
  assert.equal(pkg.schemaVersion, 2);
  assert.equal(pkg.userId, 'test-user-enc');
  assert.ok(pkg.ivBase64.length > 0);
  assert.ok(pkg.ciphertextBase64.length > 0);

  // Verify IV length is 12 bytes
  const ivBytes = ProfileVault.base64ToUint8Array(pkg.ivBase64);
  assert.equal(ivBytes.length, 12, 'IV must be strictly 12 bytes (96 bits)');

  const decrypted = await ProfileVault.decryptProfile(pkg, key, 'test-user-enc', 2);
  assert.equal(decrypted.metadata.userId, 'test-user-enc');
  for (let i = 0; i < 512; i++) {
    assert.equal(decrypted.conversationalCentroid[i], profile.conversationalCentroid[i]);
  }
});

// =================================================================
// 2. AAD & Tampering Detection Tests
// =================================================================

test('ProfileVault: AAD constructor validates domain separation and account identity', () => {
  const aad = buildProfileAAD('user_alpha_123', 2);
  const text = new TextDecoder().decode(aad);
  assert.equal(text, 'pentone:v2:user_alpha_123');

  assert.throws(() => buildProfileAAD('', 2), /userId must be a non-empty string/);
  assert.throws(() => buildProfileAAD('   ', 2), /userId must be a non-empty string/);
});

test('ProfileVault: Fails closed when expected userId does not match package userId', async () => {
  const key = await ProfileVault.generateNonExtractableKey();
  const profile = createDummyProfile('user-victim');
  const pkg = await ProfileVault.encryptProfile(profile, key);

  await assert.rejects(
    async () => await ProfileVault.decryptProfile(pkg, key, 'user-attacker', 2),
    /Profile identity mismatch: package claims 'user-victim', but expected 'user-attacker'/
  );
});

test('ProfileVault: Fails closed when AAD is tampered with', async () => {
  const key = await ProfileVault.generateNonExtractableKey();
  const profile = createDummyProfile('user-alice');
  const pkg = await ProfileVault.encryptProfile(profile, key);

  // Spoof package userId while keeping ciphertext
  const tamperedPkg = {
    ...pkg,
    userId: 'user-bob',
  };

  await assert.rejects(
    async () => await ProfileVault.decryptProfile(tamperedPkg, key, 'user-bob', 2),
    /Decryption failed: authentication tag mismatch/
  );
});

test('ProfileVault: Fails closed when ciphertext or auth tag is corrupted by 1 bit', async () => {
  const key = await ProfileVault.generateNonExtractableKey();
  const profile = createDummyProfile('user-tamper-bits');
  const pkg = await ProfileVault.encryptProfile(profile, key);

  const cipherBytes = ProfileVault.base64ToUint8Array(pkg.ciphertextBase64);
  // Flip bit in the ciphertext / auth tag
  cipherBytes[cipherBytes.length - 1] ^= 0x01;
  const tamperedCipherBase64 = ProfileVault.uint8ArrayToBase64(cipherBytes);

  const tamperedPkg = {
    ...pkg,
    ciphertextBase64: tamperedCipherBase64,
  };

  await assert.rejects(
    async () => await ProfileVault.decryptProfile(tamperedPkg, key, 'user-tamper-bits', 2),
    /Decryption failed: authentication tag mismatch/
  );
});

test('ProfileVault: Fails closed when IV is corrupted by 1 bit', async () => {
  const key = await ProfileVault.generateNonExtractableKey();
  const profile = createDummyProfile('user-tamper-iv');
  const pkg = await ProfileVault.encryptProfile(profile, key);

  const ivBytes = ProfileVault.base64ToUint8Array(pkg.ivBase64);
  ivBytes[0] ^= 0x01;
  const tamperedIvBase64 = ProfileVault.uint8ArrayToBase64(ivBytes);

  const tamperedPkg = {
    ...pkg,
    ivBase64: tamperedIvBase64,
  };

  await assert.rejects(
    async () => await ProfileVault.decryptProfile(tamperedPkg, key, 'user-tamper-iv', 2),
    /Decryption failed: authentication tag mismatch/
  );
});

test('ProfileVault: Nonce uniqueness enforces distinct 96-bit IVs across repeated encryptions', async () => {
  const key = await ProfileVault.generateNonExtractableKey();
  const profile = createDummyProfile('user-nonce-test');
  const seen = new Set<string>();

  for (let i = 0; i < 20; i++) {
    const pkg = await ProfileVault.encryptProfile(profile, key);
    assert.equal(seen.has(pkg.ivBase64), false, 'IV collision detected across repeated encryptions!');
    seen.add(pkg.ivBase64);
  }
  assert.equal(seen.size, 20);
});

// =================================================================
// 3. Isolated Stores & Manager Lifecycle Tests
// =================================================================

test('PersistentProfileVaultManager: Stores keys and profiles in separate isolated stores', async () => {
  InMemoryStructuredCloneDriver.clearAllForTest();
  const keyStore = new IndexedDBKeyStore('test_keystore_isolated');
  const profileStore = new IndexedDBProfileStore('test_profilestore_isolated');
  const manager = new PersistentProfileVaultManager(keyStore, profileStore);

  const profile = createDummyProfile('user-multi-store');
  await manager.saveProfile(profile);

  // Verify key exists in key store
  assert.equal(await keyStore.hasKey('user-multi-store'), true);
  const key = await keyStore.getKey('user-multi-store');
  assert.equal(key.extractable, false);

  // Verify profile exists in profile store
  assert.equal(await profileStore.hasProfile('user-multi-store'), true);
  const pkg = await profileStore.getProfile('user-multi-store');
  assert.ok(pkg !== null);
  assert.equal(pkg?.userId, 'user-multi-store');

  manager.close();
});

test('PersistentProfileVaultManager: Account isolation blocks cross-account decryption', async () => {
  InMemoryStructuredCloneDriver.clearAllForTest();
  const manager = new PersistentProfileVaultManager(
    new IndexedDBKeyStore('db_iso_keys'),
    new IndexedDBProfileStore('db_iso_profiles')
  );

  const profileA = createDummyProfile('account-alice');
  const profileB = createDummyProfile('account-bob');

  await manager.saveProfile(profileA);
  await manager.saveProfile(profileB);

  // Alice can load Alice
  const loadedA = await manager.loadProfile('account-alice');
  assert.equal(loadedA.metadata.userId, 'account-alice');

  // Bob can load Bob
  const loadedB = await manager.loadProfile('account-bob');
  assert.equal(loadedB.metadata.userId, 'account-bob');

  // Attacker cannot load non-existent account
  await assert.rejects(
    async () => await manager.loadProfile('account-charlie'),
    /ProfileNotFound: No stored profile found for user 'account-charlie'/
  );

  manager.close();
});

test('PersistentProfileVaultManager: Fails closed when key is missing but profile exists (refusing silent overwrite)', async () => {
  InMemoryStructuredCloneDriver.clearAllForTest();
  const keyStore = new IndexedDBKeyStore('db_failclosed_keys');
  const profileStore = new IndexedDBProfileStore('db_failclosed_profiles');
  const manager = new PersistentProfileVaultManager(keyStore, profileStore);

  const profile = createDummyProfile('user-lost-key');
  await manager.saveProfile(profile);

  // Simulate catastrophic key loss (e.g. key store cleared)
  await keyStore.deleteKey('user-lost-key');
  assert.equal(await keyStore.hasKey('user-lost-key'), false);
  assert.equal(await profileStore.hasProfile('user-lost-key'), true);

  // Attempting to load MUST fail closed
  await assert.rejects(
    async () => await manager.loadProfile('user-lost-key'),
    /KeyNotFound: No cryptographic key record exists for user 'user-lost-key'/
  );

  // Attempting to getOrInitializeKey MUST REFUSE to silently overwrite the key
  await assert.rejects(
    async () => await manager.getOrInitializeKey('user-lost-key'),
    /UnrecoverableKeyError: An encrypted profile exists for user 'user-lost-key', but its cryptographic key is missing/
  );

  manager.close();
});

test('PersistentProfileVaultManager: Explicit profile reset purges both key and profile cleanly', async () => {
  InMemoryStructuredCloneDriver.clearAllForTest();
  const keyStore = new IndexedDBKeyStore('db_reset_keys');
  const profileStore = new IndexedDBProfileStore('db_reset_profiles');
  const manager = new PersistentProfileVaultManager(keyStore, profileStore);

  const profile = createDummyProfile('user-reset');
  await manager.saveProfile(profile);

  assert.equal(await keyStore.hasKey('user-reset'), true);
  assert.equal(await profileStore.hasProfile('user-reset'), true);

  // Explicit user-initiated reset
  await manager.resetProfile('user-reset');

  assert.equal(await keyStore.hasKey('user-reset'), false);
  assert.equal(await profileStore.hasProfile('user-reset'), false);

  // Fresh re-enrollment now succeeds cleanly without UnrecoverableKeyError
  const freshProfile = createDummyProfile('user-reset');
  await manager.saveProfile(freshProfile);
  const loaded = await manager.loadProfile('user-reset');
  assert.equal(loaded.metadata.userId, 'user-reset');

  manager.close();
});

test('PersistentProfileVaultManager: Updates profile metadata with fresh IV', async () => {
  InMemoryStructuredCloneDriver.clearAllForTest();
  const manager = new PersistentProfileVaultManager(
    new IndexedDBKeyStore('db_update_keys'),
    new IndexedDBProfileStore('db_update_profiles')
  );

  const profile = createDummyProfile('user-meta-update');
  await manager.saveProfile(profile);

  // Update noise floor and calibration timestamp
  const newCalibratedAt = Date.now() + 5000;
  await manager.updateProfileMetadata('user-meta-update', (meta) => ({
    ...meta,
    lastCalibratedAt: newCalibratedAt,
    noiseFloorRms: 0.012,
  }));

  const updated = await manager.loadProfile('user-meta-update');
  assert.equal(updated.metadata.lastCalibratedAt, newCalibratedAt);
  assert.equal(updated.metadata.noiseFloorRms, 0.012);
  assert.equal(updated.conversationalCentroid.length, 512);

  manager.close();
});

test('PersistentProfileVaultManager: Persistence across DB close and simulated restart', async () => {
  InMemoryStructuredCloneDriver.clearAllForTest();
  const dbKeyName = 'db_persist_keys';
  const dbProfileName = 'db_persist_profiles';

  // 1. Initial session: enroll user
  const manager1 = new PersistentProfileVaultManager(
    new IndexedDBKeyStore(dbKeyName),
    new IndexedDBProfileStore(dbProfileName)
  );
  const originalProfile = createDummyProfile('user-restart');
  await manager1.saveProfile(originalProfile);
  manager1.close();

  // 2. Simulated restart: open new manager instances connecting to the same persistent store
  const manager2 = new PersistentProfileVaultManager(
    new IndexedDBKeyStore(dbKeyName),
    new IndexedDBProfileStore(dbProfileName)
  );

  const loaded = await manager2.loadProfile('user-restart');
  assert.equal(loaded.metadata.userId, 'user-restart');
  assert.equal(loaded.metadata.schemaVersion, 2);
  assert.equal(loaded.conversationalCentroid.length, 512);

  // Verify non-extractability survived restart
  const keyStore = new IndexedDBKeyStore(dbKeyName);
  const key = await keyStore.getKey('user-restart');
  assert.equal(key.extractable, false, 'Retrieved key must remain non-extractable after restart');

  manager2.close();
  keyStore.close();
});
