/** Format overrides for {@link buildWav}. Defaults describe exactly what the provider accepts. */
export interface WavOptions {
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly bitsPerSample?: number;
  /** Size of the `data` chunk. The default, 32000, is one second at 16 kHz mono 16-bit. */
  readonly dataBytes?: number;
  readonly audioFormat?: number;
  /** Inserts an extra chunk before `data`, as real encoders do. */
  readonly extraChunk?: string;
}

/**
 * Builds a syntactically valid WAV file with the given format.
 *
 * Shared by the parser tests and the route tests so both exercise real header bytes.
 *
 * @param options - Format overrides; omitted fields default to 16 kHz / 16-bit / mono PCM.
 * @returns The complete WAV file, with silent samples.
 */
export function buildWav(options: WavOptions = {}): ArrayBuffer {
  const {
    sampleRate = 16_000,
    channels = 1,
    bitsPerSample = 16,
    dataBytes = 32_000,
    audioFormat = 1,
    extraChunk,
  } = options;

  const extraSize = extraChunk ? 8 + 4 : 0;
  const total = 12 + 24 + extraSize + 8 + dataBytes;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, total - 8, true);
  ascii(8, 'WAVE');

  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bitsPerSample) / 8, true);
  view.setUint16(32, (channels * bitsPerSample) / 8, true);
  view.setUint16(34, bitsPerSample, true);

  let offset = 36;
  if (extraChunk) {
    ascii(offset, extraChunk);
    view.setUint32(offset + 4, 4, true);
    offset += 12;
  }

  ascii(offset, 'data');
  view.setUint32(offset + 4, dataBytes, true);

  return buffer;
}
