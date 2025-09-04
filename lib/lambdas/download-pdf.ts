import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Context } from 'aws-lambda';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface DownloadPdfEvent {
  jobId: string;
  inputLocation: string;
  bucket: string;
  key: string;
  validation: {
    size: number;
    contentType: string;
  };
  timestamp: string;
  requestId: string;
}

interface DownloadPdfResponse {
  jobId: string;
  status: 'DOWNLOADED' | 'FAILED';
  localPath?: string;
  workingDirectory?: string;
  fileInfo?: {
    size: number;
    downloadTimeSeconds: number;
    tempPath: string;
  };
  error?: string;
  nextStep: 'CONVERT' | 'FAILED';
}

export const handler = async (event: DownloadPdfEvent, context: Context): Promise<DownloadPdfResponse> => {
  const startTime = Date.now();
  
  console.log('Download PDF Lambda started');
  console.log('Event:', JSON.stringify(event, null, 2));

  const { jobId, bucket, key, validation } = event;

  try {
    console.log(`Downloading PDF for job ${jobId} from s3://${bucket}/${key}`);

    // Create working directory
    const tempDir = os.tmpdir();
    const workingDirectory = path.join(tempDir, `pdf-conversion-${jobId}`);
    const localPath = path.join(workingDirectory, 'input.pdf');

    // Ensure directory exists
    fs.mkdirSync(workingDirectory, { recursive: true });
    console.log(`Created working directory: ${workingDirectory}`);

    // Initialize S3 client
    const s3Client = new S3Client({});

    // Download the PDF file
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    console.log('Starting S3 download...');
    const response = await s3Client.send(getObjectCommand);

    if (!response.Body) {
      throw new Error('No data received from S3');
    }

    // Stream the data to a local file
    const chunks: Uint8Array[] = [];
    const stream = response.Body as any;

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(localPath, buffer);

    // Verify the downloaded file
    const downloadedSize = fs.statSync(localPath).size;
    console.log(`Downloaded ${downloadedSize.toLocaleString()} bytes to ${localPath}`);

    // Verify size matches expected
    if (downloadedSize !== validation.size) {
      console.warn(`Size mismatch: expected ${validation.size}, got ${downloadedSize}`);
    }

    // Verify file is readable
    if (!fs.existsSync(localPath)) {
      throw new Error('Downloaded file does not exist');
    }

    if (downloadedSize === 0) {
      throw new Error('Downloaded file is empty');
    }

    const downloadTimeSeconds = (Date.now() - startTime) / 1000;
    
    console.log(`PDF download completed successfully in ${downloadTimeSeconds.toFixed(2)} seconds`);

    return {
      jobId,
      status: 'DOWNLOADED',
      localPath,
      workingDirectory,
      fileInfo: {
        size: downloadedSize,
        downloadTimeSeconds,
        tempPath: localPath,
      },
      nextStep: 'CONVERT',
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const downloadTimeSeconds = (Date.now() - startTime) / 1000;
    
    console.error(`PDF download failed for job ${jobId} after ${downloadTimeSeconds.toFixed(2)} seconds:`, errorMessage);

    return {
      jobId,
      status: 'FAILED',
      error: errorMessage,
      nextStep: 'FAILED',
    };
  }
};