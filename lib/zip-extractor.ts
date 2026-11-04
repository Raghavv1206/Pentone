/**
 * Pentone Zero-Dependency Local ZIP & OOXML Container Extractor
 * 
 * Implements standard PKZip Central Directory traversal and streaming deflate
 * decompression using the native Web Streams DecompressionStream('deflate-raw') API.
 * Runs completely offline and in-memory in browser extensions and modern JavaScript runtimes.
 */

export interface ZipEntry {
  fileName: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export class ZipExtractor {
  private buffer: Uint8Array
  private dataView: DataView
  private entries: Map<string, ZipEntry> = new Map()

  private constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.buffer = buffer
      this.dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    } else {
      this.buffer = new Uint8Array(buffer)
      this.dataView = new DataView(buffer)
    }
  }

  public static async fromBuffer(buffer: ArrayBuffer | Uint8Array): Promise<ZipExtractor> {
    const extractor = new ZipExtractor(buffer)
    extractor.parseCentralDirectory()
    return extractor
  }

  /**
   * Scans from the end of the archive to locate the End of Central Directory (EOCD) record (0x06054b50).
   */
  private parseCentralDirectory(): void {
    const len = this.buffer.length
    if (len < 22) {
      throw new Error('Buffer too small to be a valid ZIP archive')
    }

    // Scan backwards from end of file for EOCD signature (max comment length is 65535 bytes)
    let eocdOffset = -1
    const searchFloor = Math.max(0, len - 65535 - 22)
    for (let i = len - 22; i >= searchFloor; i--) {
      if (
        this.buffer[i] === 0x50 &&
        this.buffer[i + 1] === 0x4b &&
        this.buffer[i + 2] === 0x05 &&
        this.buffer[i + 3] === 0x06
      ) {
        eocdOffset = i
        break
      }
    }

    if (eocdOffset === -1) {
      throw new Error('End of Central Directory record not found; invalid or corrupted ZIP container')
    }

    const totalEntries = this.dataView.getUint16(eocdOffset + 10, true)
    const centralDirectorySize = this.dataView.getUint32(eocdOffset + 12, true)
    const centralDirectoryOffset = this.dataView.getUint32(eocdOffset + 16, true)

    let cursor = centralDirectoryOffset
    const cdLimit = centralDirectoryOffset + centralDirectorySize

    for (let i = 0; i < totalEntries && cursor < cdLimit && cursor + 46 <= len; i++) {
      const sig = this.dataView.getUint32(cursor, true)
      if (sig !== 0x02014b50) {
        break
      }

      const compressionMethod = this.dataView.getUint16(cursor + 10, true)
      const compressedSize = this.dataView.getUint32(cursor + 20, true)
      const uncompressedSize = this.dataView.getUint32(cursor + 24, true)
      const fileNameLength = this.dataView.getUint16(cursor + 28, true)
      const extraFieldLength = this.dataView.getUint16(cursor + 30, true)
      const commentLength = this.dataView.getUint16(cursor + 32, true)
      const localHeaderOffset = this.dataView.getUint32(cursor + 42, true)

      const fnBytes = this.buffer.subarray(cursor + 46, cursor + 46 + fileNameLength)
      const fileName = new TextDecoder('utf-8').decode(fnBytes)

      this.entries.set(fileName, {
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      })

      cursor += 46 + fileNameLength + extraFieldLength + commentLength
    }
  }

  public getFileNames(): string[] {
    return Array.from(this.entries.keys())
  }

  public hasFile(path: string): boolean {
    return this.entries.has(path)
  }

  /**
   * Decompresses and extracts the byte content of an entry in the ZIP container.
   */
  public async readBinary(path: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(path)
    if (!entry) return null

    const offset = entry.localHeaderOffset
    if (offset + 30 > this.buffer.length) {
      throw new Error(`Corrupted local header offset for ${path}`)
    }

    const localSig = this.dataView.getUint32(offset, true)
    if (localSig !== 0x04034b50) {
      throw new Error(`Invalid local file header signature for ${path}`)
    }

    const fnLen = this.dataView.getUint16(offset + 26, true)
    const extraLen = this.dataView.getUint16(offset + 28, true)
    const dataStart = offset + 30 + fnLen + extraLen
    const dataEnd = dataStart + entry.compressedSize

    if (dataEnd > this.buffer.length) {
      throw new Error(`Compressed stream exceeds archive boundaries for ${path}`)
    }

    const compressedSlice = this.buffer.subarray(dataStart, dataEnd)

    // Uncompressed storage (Method 0)
    if (entry.compressionMethod === 0) {
      return new Uint8Array(compressedSlice)
    }

    // Standard Deflate (Method 8)
    if (entry.compressionMethod === 8) {
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw')
        const writer = ds.writable.getWriter()
        writer.write(compressedSlice)
        writer.close()

        const reader = ds.readable.getReader()
        const chunks: Uint8Array[] = []
        let total = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            total += value.length
          }
        }

        const out = new Uint8Array(total)
        let pos = 0
        for (const c of chunks) {
          out.set(c, pos)
          pos += c.length
        }
        return out
      } else {
        // Node.js fallback if DecompressionStream is polyfilled or via zlib
        const zlib = await import('zlib')
        return new Promise<Uint8Array>((resolve, reject) => {
          zlib.inflateRaw(Buffer.from(compressedSlice), (err, res) => {
            if (err) reject(err)
            else resolve(new Uint8Array(res))
          })
        })
      }
    }

    throw new Error(`Unsupported compression method ${entry.compressionMethod} in ZIP entry ${path}`)
  }

  /**
   * Reads and decodes an archive entry as UTF-8 text.
   */
  public async readText(path: string): Promise<string | null> {
    const bytes = await this.readBinary(path)
    if (!bytes) return null
    return new TextDecoder('utf-8').decode(bytes)
  }
}
