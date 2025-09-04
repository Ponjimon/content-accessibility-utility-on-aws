import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Context } from 'aws-lambda';

interface ValidateInputEvent {
  bucket: string;
  key: string;
  jobId: string;
  timestamp: string;
  requestId: string;
}

interface ValidateInputResponse {
  jobId: string;
  status: 'VALID' | 'INVALID';
  inputLocation: string;
  validation: {
    exists: boolean;
    size: number;
    contentType: string;
    isPdf: boolean;
    isAccessible: boolean;
  };
  error?: string;
  nextStep: 'DOWNLOAD' | 'FAILED';
}

export const handler = async (event: ValidateInputEvent, context: Context): Promise<ValidateInputResponse> => {
  console.log('Validate Input Lambda started');
  console.log('Event:', JSON.stringify(event, null, 2));

  const { bucket, key, jobId, timestamp, requestId } = event;
  const inputLocation = `s3://${bucket}/${key}`;

  try {
    const s3Client = new S3Client({});

    // Check if object exists and get metadata
    console.log(`Validating input file: ${inputLocation}`);
    
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const metadata = await s3Client.send(headCommand);
    
    const size = metadata.ContentLength || 0;
    const contentType = metadata.ContentType || '';
    
    console.log(`File found - Size: ${size} bytes, Content-Type: ${contentType}`);

    // Validate file size (max 50MB for Lambda processing)
    const maxSizeMB = 50;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    
    if (size > maxSizeBytes) {
      throw new Error(`File too large: ${(size / 1024 / 1024).toFixed(2)}MB exceeds ${maxSizeMB}MB limit`);
    }

    if (size === 0) {
      throw new Error('File is empty');
    }

    // Check if it's a PDF by content type and file extension
    const isPdfByExtension = key.toLowerCase().endsWith('.pdf');
    const isPdfByContentType = contentType.includes('application/pdf') || contentType.includes('pdf');
    const isPdf = isPdfByExtension || isPdfByContentType;

    if (!isPdf) {
      throw new Error(`Invalid file type. Expected PDF, got: ${contentType || 'unknown'} (${key})`);
    }

    // Quick PDF header validation - read first few bytes to check PDF signature
    let isPdfValid = false;
    try {
      const getCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: 'bytes=0-7', // Read first 8 bytes to check PDF header
      });

      const response = await s3Client.send(getCommand);
      if (response.Body) {
        const chunks: Uint8Array[] = [];
        const stream = response.Body as any;

        for await (const chunk of stream) {
          chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);
        const header = buffer.toString('ascii', 0, 4);
        isPdfValid = header === '%PDF';
        
        console.log(`PDF header validation: ${isPdfValid ? 'VALID' : 'INVALID'} (header: ${header})`);
      }
    } catch (headerError) {
      console.warn('Could not validate PDF header:', headerError);
      // If we can't read the header, assume it's valid if other checks passed
      isPdfValid = true;
    }

    if (!isPdfValid) {
      throw new Error('File does not appear to be a valid PDF (invalid header)');
    }

    const validation = {
      exists: true,
      size,
      contentType,
      isPdf: true,
      isAccessible: true, // We'll assume it's accessible for processing
    };

    console.log(`Input validation successful for job ${jobId}`);

    return {
      jobId,
      status: 'VALID',
      inputLocation,
      validation,
      nextStep: 'DOWNLOAD',
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    console.error(`Input validation failed for job ${jobId}:`, errorMessage);

    return {
      jobId,
      status: 'INVALID',
      inputLocation,
      validation: {
        exists: false,
        size: 0,
        contentType: '',
        isPdf: false,
        isAccessible: false,
      },
      error: errorMessage,
      nextStep: 'FAILED',
    };
  }
};