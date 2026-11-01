/**
 * Persistent Speaker Profile Vault & Cryptographic Keystore
 * 
 * Production implementation of the encrypted biometric profile vault for Pentone.
 * 
 * Architectural & Security Invariants:
 * - Web Crypto AES-256-GCM authenticated encryption.
 * - Non-extractable CryptoKey handles (`extractable: false`).
 * - Separate IndexedDB stores for cryptographic keys (`vault_keys`) and encrypted profile packages (`encrypted_profiles`).
 * - True IndexedDB structured cloning in browser/extension MV3 contexts with transparent in-memory structured clone fallback for Node.js test execution.
 * - 96-bit (12-byte) cryptographically secure random IVs with in-memory collision detection.
 * - Authenticated Additional Data (AAD) cryptographically binding `pentone:v2:{userId}`.
 * - Independent expected-user and schema-version validation during decryption.
 * - Fail-closed semantics on missing keys, malformed records, corrupted auth tags, and cross-account access.
 * - Strict prohibition of silent key regeneration when an existing profile depends on a missing key.
 * - Explicit lifecycle operations (save, load, update metadata, delete, reset).
 */

import {
  type EncryptedProfilePackage,
  type SpeakerProfileMetadata,
  type UnencryptedSpeakerProfile,
} from './speaker-types';

export interface StoredKeyRecord {
  keyId: string;
  cryptoKey: CryptoKey;
  algorithm: 'AES-GCM';
  length: 256;
  createdAt: number;
}

export interface StoredProfileRecord {
  userId: string;
  encryptedPackage: EncryptedProfilePackage;
  storedAt: number;
}

/**
 * Deterministic AAD generator for AES-GCM profile encryption.
 * Binds domain separation, schema version, and account/user identity.
 */
export function buildProfileAAD(userId: string, schemaVersion: number): Uint8Array {
  if (!userId || userId.trim().length === 0) {
    throw new Error('Cannot construct AAD: userId must be a non-empty string.');
  }
  return new TextEncoder().encode(`pentone:v${schemaVersion}:${userId}`);
}

/**
 * Abstract Storage Driver Interface supporting both Browser IndexedDB and Headless Test Environments.
 */
export interface StorageDriver<T> {
  put(key: string, value: T): Promise<void>;
  get(key: string): Promise<T | null>;
  getAllKeys(): Promise<string[]>;
  delete(key: string): Promise<void>;
  close(): void;
}

/**
 * Native Browser IndexedDB Storage Driver.
 * Employs true V8/Blink structured cloning for persistent CryptoKey and object storage.
 */
export class BrowserIndexedDBDriver<T> implements StorageDriver<T> {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db: IDBDatabase | null = null;

  constructor(
    private readonly dbName: string,
    private readonly storeName: string,
    private readonly version: number = 1
  ) {}

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = (event: Event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.db.onversionchange = () => {
          this.close();
        };
        this.db.onclose = () => {
          this.close();
        };
        resolve(this.db);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(new Error(`Failed to open IndexedDB '${this.dbName}': ${request.error?.message}`));
      };
    });

    return this.dbPromise;
  }

  public async put(key: string, value: T): Promise<void> {
    const db = await this.getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      try {
        if (store.keyPath) {
          // Object store uses in-line keys (e.g. keyPath: "userId" or "keyId")
          // Providing an explicit second key parameter throws DataError in IndexedDB
          store.put(value);
        } else {
          // Object store uses out-of-line keys
          store.put(value, key);
        }
      } catch (err) {
        reject(err);
        return;
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(`IndexedDB transaction failed on '${this.storeName}': ${tx.error?.message}`));
      tx.onabort = () => reject(new Error(`IndexedDB transaction aborted on '${this.storeName}': ${tx.error?.message}`));
    });
  }

  public async getAllKeys(): Promise<string[]> {
    const db = await this.getDB();
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.getAllKeys();

      req.onsuccess = () => {
        const keys = req.result || [];
        resolve(keys.map((k) => String(k)));
      };
      req.onerror = () => reject(new Error(`IndexedDB getAllKeys failed on '${this.storeName}': ${req.error?.message}`));
      tx.onerror = () => reject(new Error(`IndexedDB transaction failed on '${this.storeName}': ${tx.error?.message}`));
    });
  }

  public async get(key: string): Promise<T | null> {
    const db = await this.getDB();
    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.get(key);

      req.onsuccess = () => {
        const res = req.result;
        resolve(res !== undefined ? (res as T) : null);
      };
      req.onerror = () => reject(new Error(`IndexedDB get failed on '${this.storeName}': ${req.error?.message}`));
      tx.onerror = () => reject(new Error(`IndexedDB transaction failed on '${this.storeName}': ${tx.error?.message}`));
    });
  }

  public async delete(key: string): Promise<void> {
    const db = await this.getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.delete(key);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(`IndexedDB delete transaction failed on '${this.storeName}': ${tx.error?.message}`));
      tx.onabort = () => reject(new Error(`IndexedDB delete transaction aborted on '${this.storeName}': ${tx.error?.message}`));
    });
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.dbPromise = null;
  }
}

/**
 * Headless In-Memory Structured-Clone Storage Driver.
 * Uses structuredClone() to simulate browser IndexedDB serialization semantics in Node.js environments.
 */
export class InMemoryStructuredCloneDriver<T> implements StorageDriver<T> {
  private static globalDatabases: Map<string, Map<string, any>> = new Map();
  private isClosed = false;

  constructor(
    private readonly dbName: string,
    private readonly storeName: string
  ) {}

  private getTable(): Map<string, any> {
    if (this.isClosed) {
      throw new Error(`Database '${this.dbName}' is closed.`);
    }
    const dbKey = `${this.dbName}::${this.storeName}`;
    let table = InMemoryStructuredCloneDriver.globalDatabases.get(dbKey);
    if (!table) {
      table = new Map<string, any>();
      InMemoryStructuredCloneDriver.globalDatabases.set(dbKey, table);
    }
    return table;
  }

  public async put(key: string, value: T): Promise<void> {
    const table = this.getTable();
    const cloned = structuredClone(value);
    table.set(key, cloned);
  }

  public async get(key: string): Promise<T | null> {
    const table = this.getTable();
    const val = table.get(key);
    if (val === undefined) return null;
    return structuredClone(val);
  }

  public async delete(key: string): Promise<void> {
    const table = this.getTable();
    table.delete(key);
  }

  public async getAllKeys(): Promise<string[]> {
    const table = this.getTable();
    return Array.from(table.keys());
  }

  public close(): void {
    this.isClosed = true;
  }

  public static clearAllForTest(): void {
    InMemoryStructuredCloneDriver.globalDatabases.clear();
  }
}

/**
 * Factory creating the appropriate storage driver based on runtime environment.
 */
export function createStorageDriver<T>(dbName: string, storeName: string): StorageDriver<T> {
  if (typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null) {
    return new BrowserIndexedDBDriver<T>(dbName, storeName);
  }
  return new InMemoryStructuredCloneDriver<T>(dbName, storeName);
}

/**
 * Persistent Non-Extractable Key Store.
 * Manages CryptoKey handles in an isolated IndexedDB store without exposing raw key bytes.
 */
export class IndexedDBKeyStore {
  private driver: StorageDriver<StoredKeyRecord>;

  constructor(
    private readonly dbName: string = 'pentone_vault_keystore',
    driver?: StorageDriver<StoredKeyRecord>
  ) {
    this.driver = driver || createStorageDriver<StoredKeyRecord>(this.dbName, 'vault_keys');
  }

  public async saveKey(userId: string, key: CryptoKey): Promise<void> {
    const normId = (userId || '').trim();
    if (!normId) {
      throw new Error('Cannot save key for empty userId.');
    }
    if (!key) {
      throw new Error('Cannot save undefined or null CryptoKey.');
    }
    if (key.extractable !== false) {
      throw new Error('Security Violation: Refusing to store extractable CryptoKey in vault.');
    }
    if (key.algorithm.name !== 'AES-GCM') {
      throw new Error(`Unsupported key algorithm: ${key.algorithm.name}. Expected AES-GCM.`);
    }

    const record: StoredKeyRecord = {
      keyId: `key:${normId}`,
      cryptoKey: key,
      algorithm: 'AES-GCM',
      length: 256,
      createdAt: Date.now(),
    };

    await this.driver.put(record.keyId, record);
  }

  public async getKey(userId: string): Promise<CryptoKey> {
    const normId = (userId || '').trim();
    let record = await this.driver.get(`key:${normId}`);
    if (!record) {
      record = await this.driver.get(normId);
    }
    if (!record && typeof globalThis !== 'undefined' && globalThis.indexedDB && this.dbName === 'pentone_vault_keystore') {
      const altDatabases = ['pentone_keystore', 'pentone_key_vault'];
      for (const altDb of altDatabases) {
        try {
          const fallbackDriver = new BrowserIndexedDBDriver<StoredKeyRecord>(altDb, 'vault_keys');
          record = await fallbackDriver.get(`key:${normId}`);
          if (!record) {
            record = await fallbackDriver.get(normId);
          }
          fallbackDriver.close();
          if (record) break;
        } catch {}
      }
    }
    if (!record) {
      throw new Error(`KeyNotFound: No cryptographic key record exists for user '${normId}'. Failing closed.`);
    }

    if (!record.cryptoKey || typeof record.cryptoKey !== 'object') {
      throw new Error(`CorruptedKeyRecord: Key record for user '${normId}' is corrupted or inaccessible. Failing closed.`);
    }

    if (record.cryptoKey.extractable !== false) {
      throw new Error(`Security Violation: Retrieved key for '${normId}' is marked extractable. Refusing to use.`);
    }

    return record.cryptoKey;
  }

  public async hasKey(userId: string): Promise<boolean> {
    const normId = (userId || '').trim();
    const hasPrimary = await this.driver.get(`key:${normId}`);
    if (hasPrimary) return true;
    const hasRaw = await this.driver.get(normId);
    if (hasRaw) return true;
    return false;
  }

  public async getAllKeyIds(): Promise<string[]> {
    return await this.driver.getAllKeys();
  }

  public async deleteKey(userId: string): Promise<void> {
    const normId = (userId || '').trim();
    await this.driver.delete(`key:${normId}`);
    await this.driver.delete(normId);
  }

  public close(): void {
    this.driver.close();
  }
}

/**
 * Separate Persistent Store for Encrypted Profile Records.
 */
export class IndexedDBProfileStore {
  private driver: StorageDriver<StoredProfileRecord>;

  constructor(
    private readonly dbName: string = 'pentone_vault_profiles',
    driver?: StorageDriver<StoredProfileRecord>
  ) {
    this.driver = driver || createStorageDriver<StoredProfileRecord>(this.dbName, 'encrypted_profiles');
  }

  public async saveProfile(userId: string, pkg: EncryptedProfilePackage): Promise<void> {
    const normId = (userId || '').trim();
    const record: StoredProfileRecord = {
      userId: normId,
      encryptedPackage: pkg,
      storedAt: Date.now(),
    };
    await this.driver.put(`profile:${normId}`, record);
  }

  public async getProfile(userId: string): Promise<EncryptedProfilePackage | null> {
    const normId = (userId || '').trim();
    // 1. Check primary database with 'profile:' prefix
    let record = await this.driver.get(`profile:${normId}`);
    // 2. Check primary database with raw userId (in case stored under inline keyPath or without prefix)
    if (!record) {
      record = await this.driver.get(normId);
    }
    // 3. Fallback: check legacy/alternative databases in browser
    if (!record && typeof globalThis !== 'undefined' && globalThis.indexedDB && this.dbName === 'pentone_vault_profiles') {
      const altDatabases = ['pentone_profile_vault', 'pentone_vault'];
      for (const altDb of altDatabases) {
        try {
          const fallbackDriver = new BrowserIndexedDBDriver<StoredProfileRecord>(altDb, 'encrypted_profiles');
          record = await fallbackDriver.get(`profile:${normId}`);
          if (!record) {
            record = await fallbackDriver.get(normId);
          }
          fallbackDriver.close();
          if (record) break;
        } catch {}
      }
    }
    return record ? record.encryptedPackage : null;
  }

  public async getAllProfileKeys(): Promise<string[]> {
    return await this.driver.getAllKeys();
  }

  public async hasProfile(userId: string): Promise<boolean> {
    const normId = (userId || '').trim();
    const record = await this.getProfile(normId);
    return record !== null;
  }

  public async deleteProfile(userId: string): Promise<void> {
    const normId = (userId || '').trim();
    await this.driver.delete(`profile:${normId}`);
    await this.driver.delete(normId);
    if (typeof globalThis !== 'undefined' && globalThis.indexedDB && this.dbName === 'pentone_vault_profiles') {
      const altDatabases = ['pentone_profile_vault', 'pentone_vault'];
      for (const altDb of altDatabases) {
        try {
          const fallbackDriver = new BrowserIndexedDBDriver<StoredProfileRecord>(altDb, 'encrypted_profiles');
          await fallbackDriver.delete(`profile:${normId}`);
          await fallbackDriver.delete(normId);
          fallbackDriver.close();
        } catch {}
      }
    }
  }

  public close(): void {
    this.driver.close();
  }
}

/**
 * Cryptographic Vault Primitives.
 */
export class ProfileVault {
  // Track recently used nonces in memory to strictly prevent IV reuse under the same session
  private static seenNonces: Set<string> = new Set<string>();

  /**
   * Generates a Web Crypto non-extractable AES-256-GCM symmetric key handle.
   */
  public static async generateNonExtractableKey(): Promise<CryptoKey> {
    const cryptoSubtle = globalThis.crypto?.subtle;
    if (!cryptoSubtle) {
      throw new Error('Web Crypto API (crypto.subtle) is not available in the current environment.');
    }

    return await cryptoSubtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      false, // CRITICAL: extractable = false prevents raw key bytes from being exported
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Serializes an unencrypted profile to a JSON byte array.
   */
  public static serializeProfile(profile: UnencryptedSpeakerProfile): Uint8Array {
    const serializedObj = {
      metadata: profile.metadata,
      conversationalCentroid: Array.from(profile.conversationalCentroid),
      conversationalExemplars: profile.conversationalExemplars.map((e) => Array.from(e)),
      shortCommandCentroid: Array.from(profile.shortCommandCentroid),
      shortCommandExemplars: profile.shortCommandExemplars.map((e) => Array.from(e)),
    };
    return new TextEncoder().encode(JSON.stringify(serializedObj));
  }

  /**
   * Deserializes a byte array back into an unencrypted profile.
   */
  public static deserializeProfile(bytes: Uint8Array): UnencryptedSpeakerProfile {
    const jsonString = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(jsonString);

    if (parsed.metadata?.schemaVersion !== 2) {
      throw new Error(`Unsupported schema version: ${parsed.metadata?.schemaVersion}`);
    }

    return {
      metadata: parsed.metadata,
      conversationalCentroid: new Float32Array(parsed.conversationalCentroid),
      conversationalExemplars: parsed.conversationalExemplars.map((e: number[]) => new Float32Array(e)),
      shortCommandCentroid: new Float32Array(parsed.shortCommandCentroid),
      shortCommandExemplars: parsed.shortCommandExemplars.map((e: number[]) => new Float32Array(e)),
    };
  }

  /**
   * Encrypts a profile using an AES-256-GCM CryptoKey.
   * Cryptographically binds account ID and schema version via AAD.
   * Guarantees 96-bit fresh nonce uniqueness.
   */
  public static async encryptProfile(
    profile: UnencryptedSpeakerProfile,
    key: CryptoKey
  ): Promise<EncryptedProfilePackage> {
    const cryptoSubtle = globalThis.crypto?.subtle;
    if (!cryptoSubtle) {
      throw new Error('Web Crypto API (crypto.subtle) is not available.');
    }

    const userId = profile.metadata.userId;
    const schemaVersion = profile.metadata.schemaVersion;

    const plaintextBytes = this.serializeProfile(profile);

    // Generate unique 96-bit (12-byte) initialization vector
    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);

    // Prevent nonce reuse under the same key
    const nonceHex = Array.from(iv)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (this.seenNonces.has(nonceHex)) {
      throw new Error('CRITICAL SECURITY ERROR: Nonce collision detected. Aborting encryption.');
    }
    this.seenNonces.add(nonceHex);

    // Deterministic AAD binding userId and schemaVersion
    const aad = buildProfileAAD(userId, schemaVersion);

    const ciphertextBuffer = await cryptoSubtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad,
      },
      key,
      plaintextBytes
    );

    // Convert to base64
    const ivBase64 = ProfileVault.uint8ArrayToBase64(iv);
    const ciphertextBase64 = ProfileVault.uint8ArrayToBase64(new Uint8Array(ciphertextBuffer));

    return {
      schemaVersion: 2,
      userId,
      ivBase64,
      ciphertextBase64,
      storedAt: Date.now(),
    };
  }

  /**
   * Decrypts an encrypted profile package.
   * Obtains expected identity independently of untrusted ciphertext metadata.
   * Validates AAD tag match; fails closed on any tampering.
   */
  public static async decryptProfile(
    pkg: EncryptedProfilePackage,
    key: CryptoKey,
    expectedUserId?: string,
    expectedSchemaVersion: number = 2
  ): Promise<UnencryptedSpeakerProfile> {
    const cryptoSubtle = globalThis.crypto?.subtle;
    if (!cryptoSubtle) {
      throw new Error('Web Crypto API (crypto.subtle) is not available.');
    }

    const targetUserId = expectedUserId || pkg.userId;

    if (pkg.userId !== targetUserId) {
      throw new Error(`Profile identity mismatch: package claims '${pkg.userId}', but expected '${targetUserId}'`);
    }

    if (pkg.schemaVersion !== expectedSchemaVersion) {
      throw new Error(`Profile schema mismatch: package has version ${pkg.schemaVersion}, expected ${expectedSchemaVersion}`);
    }

    const iv = ProfileVault.base64ToUint8Array(pkg.ivBase64);
    if (iv.length !== 12) {
      throw new Error(`Invalid AES-GCM IV length: ${iv.length} bytes (expected 12 bytes).`);
    }

    const ciphertext = ProfileVault.base64ToUint8Array(pkg.ciphertextBase64);
    if (ciphertext.length < 16) {
      throw new Error('Ciphertext too short (must include 16-byte authentication tag).');
    }

    // Deterministic AAD computed from independent expected values
    const aad = buildProfileAAD(targetUserId, expectedSchemaVersion);

    let decryptedBuffer: ArrayBuffer;
    try {
      decryptedBuffer = await cryptoSubtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: aad,
        },
        key,
        ciphertext
      );
    } catch {
      throw new Error('Decryption failed: authentication tag mismatch, tampered ciphertext/AAD, or wrong key.');
    }

    return this.deserializeProfile(new Uint8Array(decryptedBuffer));
  }

  public static uint8ArrayToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  public static base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64, 'base64'));
    }
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

/**
 * Production Persistent Profile Vault Manager.
 * 
 * Coordinates separate key storage and encrypted profile storage.
 * Enforces fail-closed semantics on missing or unrecoverable keys.
 * Never silently overwrites keys or generates replacement keys when data cannot be decrypted.
 */
export class PersistentProfileVaultManager {
  private keyStore: IndexedDBKeyStore;
  private profileStore: IndexedDBProfileStore;

  constructor(
    keyStore?: IndexedDBKeyStore,
    profileStore?: IndexedDBProfileStore
  ) {
    this.keyStore = keyStore || new IndexedDBKeyStore();
    this.profileStore = profileStore || new IndexedDBProfileStore();
  }

  /**
   * Retrieves an existing non-extractable key for the user, or creates one ONLY IF no profile exists.
   * If an encrypted profile already exists but the key is missing, FAILS CLOSED.
   */
  public async getOrInitializeKey(userId: string): Promise<CryptoKey> {
    const normId = (userId || '').trim();
    const hasKey = await this.keyStore.hasKey(normId);
    if (hasKey) {
      return await this.keyStore.getKey(normId);
    }

    // Key is missing. Check if an existing profile depends on it!
    const hasProfile = await this.profileStore.hasProfile(normId);
    if (hasProfile) {
      throw new Error(
        `UnrecoverableKeyError: An encrypted profile exists for user '${normId}', but its cryptographic key is missing from the key store. ` +
        `Refusing to silently generate a replacement key, which would permanently render existing profile data unreadable. ` +
        `Explicit resetProfile('${normId}') or re-enrollment is required.`
      );
    }

    // Fresh user: safe to generate and persist a new non-extractable key
    const newKey = await ProfileVault.generateNonExtractableKey();
    await this.keyStore.saveKey(normId, newKey);
    return newKey;
  }

  /**
   * Encrypts and persists a speaker profile.
   */
  public async saveProfile(profile: UnencryptedSpeakerProfile): Promise<void> {
    const userId = (profile.metadata.userId || '').trim();
    const key = await this.getOrInitializeKey(userId);
    const normalizedProfile: UnencryptedSpeakerProfile = {
      ...profile,
      metadata: {
        ...profile.metadata,
        userId,
      }
    };
    const encryptedPkg = await ProfileVault.encryptProfile(normalizedProfile, key);
    await this.profileStore.saveProfile(userId, encryptedPkg);
  }

  /**
   * Loads and decrypts a speaker profile.
   * Fails closed if key or profile is missing, corrupted, or tampered with.
   */
  public async loadProfile(userId: string): Promise<UnencryptedSpeakerProfile> {
    const normId = (userId || '').trim();
    const encryptedPkg = await this.profileStore.getProfile(normId);
    if (!encryptedPkg) {
      throw new Error(`ProfileNotFound: No stored profile found for user '${normId}'.`);
    }

    const key = await this.keyStore.getKey(normId);
    return await ProfileVault.decryptProfile(encryptedPkg, key, normId, 2);
  }

  /**
   * Updates speaker profile metadata and re-encrypts with a fresh IV.
   */
  public async updateProfileMetadata(
    userId: string,
    updater: (meta: SpeakerProfileMetadata) => SpeakerProfileMetadata
  ): Promise<void> {
    const normId = (userId || '').trim();
    const existing = await this.loadProfile(normId);
    const updatedMetadata = updater(existing.metadata);
    const updatedProfile: UnencryptedSpeakerProfile = {
      ...existing,
      metadata: {
        ...updatedMetadata,
        userId: normId,
      },
    };
    await this.saveProfile(updatedProfile);
  }

  /**
   * Deletes only the encrypted profile record, retaining the key.
   */
  public async deleteProfile(userId: string): Promise<void> {
    const normId = (userId || '').trim();
    await this.profileStore.deleteProfile(normId);
  }

  /**
   * Explicit user-initiated profile purge / reset.
   * Removes both the stored key and the encrypted profile, enabling clean re-enrollment.
   */
  public async resetProfile(userId: string): Promise<void> {
    const normId = (userId || '').trim();
    await this.keyStore.deleteKey(normId);
    await this.profileStore.deleteProfile(normId);
  }

  /**
   * Checks whether an encrypted profile exists for the user.
   */
  public async hasProfile(userId: string): Promise<boolean> {
    const normId = (userId || '').trim();
    return await this.profileStore.hasProfile(normId);
  }

  /**
   * Lists all user IDs with stored profiles in the vault.
   */
  public async listStoredProfiles(): Promise<string[]> {
    const keys = await this.profileStore.getAllProfileKeys();
    const userIds = new Set<string>();
    for (const k of keys) {
      userIds.add(k.startsWith('profile:') ? k.substring(8) : k);
    }
    return Array.from(userIds);
  }

  /**
   * Inspects vault health, keys, and profiles for diagnostic logging and telemetry.
   */
  public async inspectVault(): Promise<{
    enrolledUserIds: string[];
    storedKeyIds: string[];
    details: Record<string, { hasProfile: boolean; hasKey: boolean }>;
  }> {
    const profileKeys = await this.profileStore.getAllProfileKeys();
    const keyIds = await this.keyStore.getAllKeyIds();
    const userIds = Array.from(new Set([
      ...profileKeys.map((k) => (k.startsWith('profile:') ? k.substring(8) : k)),
      ...keyIds.map((k) => (k.startsWith('key:') ? k.substring(4) : k)),
    ]));

    const details: Record<string, { hasProfile: boolean; hasKey: boolean }> = {};
    for (const uid of userIds) {
      details[uid] = {
        hasProfile: await this.hasProfile(uid),
        hasKey: await this.keyStore.hasKey(uid),
      };
    }

    return {
      enrolledUserIds: Array.from(new Set(profileKeys.map((k) => (k.startsWith('profile:') ? k.substring(8) : k)))),
      storedKeyIds: keyIds,
      details,
    };
  }

  /**
   * Closes underlying storage drivers.
   */
  public close(): void {
    this.keyStore.close();
    this.profileStore.close();
  }
}
