// Minimal ZIP writer - STORE method only (no compression), enough to bundle
// a handful of small text files for download. Hand-rolled rather than a
// dependency: the ZIP container format itself (local file headers, central
// directory, end record) is a small, well-documented, deterministic binary
// layout - see the PKWARE APPNOTE.TXT format, ยง4.3 - and STORE mode needs
// no compression algorithm, just a CRC-32 (also standard, table-based).
// Every modern browser and OS can open a STORE-mode zip with zero caveats.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Builds a valid STORE-mode .zip file from a list of {name, text} entries and returns it as a downloadable Blob. */
export function createZip(files: { name: string; text: string }[]): Blob {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = files.map((f) => ({ name: f.name, data: encoder.encode(f.text) }));
  const { time, date } = dosDateTime(new Date());

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0, true); // flags
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size
    local.setUint32(22, size, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra field length
    localParts.push(new Uint8Array(local.buffer), nameBytes, entry.data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint16(8, 0, true); // flags
    central.setUint16(10, 0, true); // method: stored
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true); // extra field length
    central.setUint16(32, 0, true); // comment length
    central.setUint16(34, 0, true); // disk number start
    central.setUint16(36, 0, true); // internal attributes
    central.setUint32(38, 0, true); // external attributes
    central.setUint32(42, offset, true); // offset of local header
    centralParts.push(new Uint8Array(central.buffer), nameBytes);

    offset += local.byteLength + nameBytes.length + entry.data.length;
  }

  const centralDirSize = centralParts.reduce((sum, p) => sum + p.length, 0);
  const centralDirOffset = offset;

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true); // this disk
  end.setUint16(6, 0, true); // central dir start disk
  end.setUint16(8, entries.length, true); // records on this disk
  end.setUint16(10, entries.length, true); // total records
  end.setUint32(12, centralDirSize, true);
  end.setUint32(16, centralDirOffset, true);
  end.setUint16(20, 0, true); // comment length

  return new Blob([...localParts, ...centralParts, new Uint8Array(end.buffer)], { type: "application/zip" });
}

/** Triggers a browser download of a Blob with the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
