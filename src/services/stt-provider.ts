export interface STTProvider {
  transcribe(input: {
    filePath: string;
    mimeType?: string;
  }): Promise<{ text: string }>;
}
