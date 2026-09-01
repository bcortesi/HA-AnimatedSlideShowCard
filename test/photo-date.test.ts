import { describe, expect, it } from "vitest";
import {
  PhotoDateResolver,
  dateFromExif,
  dateFromFilename,
  formatDate,
} from "../src/photo-date";

describe("formatDate", () => {
  it("formats as dd/mm/yyyy with zero padding", () => {
    expect(formatDate(new Date(2024, 2, 5))).toBe("05/03/2024");
    expect(formatDate(new Date(2024, 11, 31))).toBe("31/12/2024");
  });
});

describe("dateFromFilename", () => {
  it("reads the common phone camera patterns", () => {
    const cases: [string, string][] = [
      ["IMG_20240315_143022.jpg", "15/03/2024"], // Samsung / generic Android
      ["PXL_20231225_101500123.jpg", "25/12/2023"], // Pixel
      ["VID_20220101_000500.mp4", "01/01/2022"],
      ["20240315_143022.jpg", "15/03/2024"],
      ["IMG-20240315-WA0001.jpg", "15/03/2024"], // WhatsApp
      ["Screenshot_20240315-143022.png", "15/03/2024"],
      ["Screenshot 2024-03-15 at 14.30.22.png", "15/03/2024"],
      ["2024-03-15_14-30-22.jpg", "15/03/2024"],
      ["signal-2024-03-15-143022.jpg", "15/03/2024"],
      ["2024-03-15.jpg", "15/03/2024"],
    ];

    for (const [name, expected] of cases) {
      const date = dateFromFilename(name);
      expect(date, `no date found in ${name}`).not.toBeNull();
      expect(formatDate(date!), name).toBe(expected);
    }
  });

  it("returns null for names that carry no date", () => {
    // The iPhone case, and the reason the EXIF fallback exists at all.
    for (const name of ["IMG_1234.JPG", "DSC00123.jpg", "photo.png", "", "a.jpg"]) {
      expect(dateFromFilename(name), name).toBeNull();
    }
    expect(dateFromFilename(undefined)).toBeNull();
    expect(dateFromFilename(null)).toBeNull();
  });

  it("refuses digit runs that only look like dates", () => {
    // Guards against confidently showing a wrong date, which is worse than
    // showing none.
    for (const name of ["IMG_12345678.jpg", "IMG_99999999.jpg", "file_18000101.jpg"]) {
      expect(dateFromFilename(name), name).toBeNull();
    }
  });

  it("rejects impossible calendar dates", () => {
    expect(dateFromFilename("IMG_20240231_120000.jpg")).toBeNull(); // 31 February
    expect(dateFromFilename("IMG_20241301_120000.jpg")).toBeNull(); // month 13
    expect(dateFromFilename("IMG_20240300_120000.jpg")).toBeNull(); // day 0
  });

  it("is not fooled by a year in the extension or a counter", () => {
    expect(dateFromFilename("holiday.2024.jpg")).toBeNull();
    expect(dateFromFilename("IMG_0001.jpg")).toBeNull();
  });
});

/**
 * Build a minimal but structurally valid JPEG carrying an EXIF DateTimeOriginal,
 * so the parser is exercised against real bytes rather than a mock.
 */
function makeJpegWithExif(
  dateText: string,
  { little = true, tag = 0x9003 }: { little?: boolean; tag?: number } = {},
): ArrayBuffer {
  const ascii = `${dateText}\0`;
  const tiff: number[] = [];

  const push16 = (v: number) => {
    if (little) tiff.push(v & 0xff, (v >> 8) & 0xff);
    else tiff.push((v >> 8) & 0xff, v & 0xff);
  };
  const push32 = (v: number) => {
    if (little) tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    else tiff.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  };

  // TIFF header
  if (little) tiff.push(0x49, 0x49);
  else tiff.push(0x4d, 0x4d);
  push16(0x002a);
  push32(8); // IFD0 begins right after the header

  // IFD0: one entry, the pointer to the Exif IFD
  push16(1);
  push16(0x8769);
  push16(4); // LONG
  push32(1);
  push32(26); // offset of the Exif IFD within the TIFF block
  push32(0); // no next IFD

  // Exif IFD at offset 26: one entry, the date
  push16(1);
  push16(tag);
  push16(2); // ASCII
  push32(ascii.length);
  push32(44); // offset of the string within the TIFF block
  push32(0);

  for (const char of ascii) tiff.push(char.charCodeAt(0));

  const app1Body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const app1Length = app1Body.length + 2;

  const bytes = [
    0xff, 0xd8, // SOI
    0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff,
    ...app1Body,
    0xff, 0xda, 0x00, 0x02, // SOS
  ];

  return new Uint8Array(bytes).buffer;
}

describe("dateFromExif", () => {
  it("reads DateTimeOriginal from a little-endian JPEG", () => {
    const date = dateFromExif(makeJpegWithExif("2024:03:15 14:30:22"));
    expect(date).not.toBeNull();
    expect(formatDate(date!)).toBe("15/03/2024");
  });

  it("reads big-endian EXIF too", () => {
    // Both byte orders occur in the wild; Canon and Nikon differ here.
    const date = dateFromExif(makeJpegWithExif("2019:07:04 09:05:00", { little: false }));
    expect(date).not.toBeNull();
    expect(formatDate(date!)).toBe("04/07/2019");
  });

  it("falls back to DateTimeDigitized when there is no original", () => {
    const date = dateFromExif(makeJpegWithExif("2021:11:02 08:00:00", { tag: 0x9004 }));
    expect(formatDate(date!)).toBe("02/11/2021");
  });

  it("returns null rather than throwing on anything that is not usable", () => {
    const cases: ArrayBuffer[] = [
      new ArrayBuffer(0),
      new Uint8Array([0xff, 0xd8]).buffer, // JPEG with nothing in it
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, // PNG
      new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]).buffer, // no EXIF
      new Uint8Array(Array.from({ length: 64 }, (_, i) => i)).buffer, // junk
    ];

    for (const buffer of cases) {
      expect(() => dateFromExif(buffer)).not.toThrow();
      expect(dateFromExif(buffer)).toBeNull();
    }
  });

  it("survives a truncated EXIF block", () => {
    const full = new Uint8Array(makeJpegWithExif("2024:03:15 14:30:22"));
    for (const cut of [10, 20, 30, 40, 50]) {
      const truncated = full.slice(0, cut).buffer;
      expect(() => dateFromExif(truncated)).not.toThrow();
    }
  });

  it("rejects an EXIF date that is not a real date", () => {
    expect(dateFromExif(makeJpegWithExif("2024:02:31 10:00:00"))).toBeNull();
    expect(dateFromExif(makeJpegWithExif("0000:00:00 00:00:00"))).toBeNull();
  });
});

describe("PhotoDateResolver", () => {
  it("uses the filename without any fetch", async () => {
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const resolver = new PhotoDateResolver();
    const date = await resolver.resolve("a1", "IMG_20240315_143022.jpg", "/x.jpg");

    expect(formatDate(date!)).toBe("15/03/2024");
    expect(fetches).toBe(0);
  });

  it("falls back to fetching EXIF when the filename has no date", async () => {
    const buffer = makeJpegWithExif("2022:05:09 11:00:00");
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      return new Response(buffer, { headers: { "content-length": String(buffer.byteLength) } });
    }) as typeof fetch;

    const resolver = new PhotoDateResolver();
    const date = await resolver.resolve("a2", "IMG_1234.JPG", "/x.jpg");

    expect(formatDate(date!)).toBe("09/05/2022");
    expect(fetches).toBe(1);
  });

  it("inspects a photo only once, including when it has no date", async () => {
    // A wall display revisits the same photos for weeks; re-fetching a
    // dateless photo every cycle would be a permanent background cost.
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      return new Response(new Uint8Array([0x89, 0x50]).buffer);
    }) as typeof fetch;

    const resolver = new PhotoDateResolver();
    expect(await resolver.resolve("a3", "IMG_1234.JPG", "/x.jpg")).toBeNull();
    expect(await resolver.resolve("a3", "IMG_1234.JPG", "/x.jpg")).toBeNull();
    expect(await resolver.resolve("a3", "IMG_1234.JPG", "/x.jpg")).toBeNull();

    expect(fetches).toBe(1);
  });

  it("never lets a failed fetch escape", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const resolver = new PhotoDateResolver();
    await expect(resolver.resolve("a4", "IMG_1234.JPG", "/x.jpg")).resolves.toBeNull();
  });

  it("can skip EXIF entirely", async () => {
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      return new Response(null);
    }) as typeof fetch;

    const resolver = new PhotoDateResolver(false);
    expect(await resolver.resolve("a5", "IMG_1234.JPG", "/x.jpg")).toBeNull();
    expect(fetches).toBe(0);
  });
});
