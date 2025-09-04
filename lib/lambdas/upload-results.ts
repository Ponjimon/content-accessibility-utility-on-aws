import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Context } from 'aws-lambda';
import * as fs from 'fs';
import * as path from 'path';

interface UploadResultsEvent {
  jobId: string;
  bucket: string;
  key: string;
  conversionResult: {
    htmlFiles: string[];
    cssFiles: string[];
    imageFiles: string[];
    totalFiles: number;
    outputDirectory: string;
  };
  timestamp: string;
  requestId: string;
}

interface UploadResultsResponse {
  jobId: string;
  status: 'UPLOADED' | 'FAILED';
  uploadedFiles?: {
    htmlFiles: string[];
    cssFiles: string[];
    imageFiles: string[];
    totalUploaded: number;
    outputLocation: string;
  };
  uploadTimeSeconds?: number;
  error?: string;
  nextStep: 'CLEANUP' | 'FAILED';
}

export const handler = async (event: UploadResultsEvent, context: Context): Promise<UploadResultsResponse> => {
  const startTime = Date.now();
  
  console.log('Upload Results Lambda started');
  console.log('Event:', JSON.stringify(event, null, 2));

  const { jobId, bucket, key, conversionResult, timestamp, requestId } = event;

  try {
    console.log(`Uploading conversion results for job ${jobId} to s3://${bucket}/htmls/`);

    const s3Client = new S3Client({});
    const baseFileName = path.basename(key, '.pdf');
    const outputPrefix = 'htmls/';
    
    const uploadedFiles = {
      htmlFiles: [] as string[],
      cssFiles: [] as string[],
      imageFiles: [] as string[],
      totalUploaded: 0,
      outputLocation: `s3://${bucket}/${outputPrefix}`,
    };

    // Upload HTML files
    for (const htmlFile of conversionResult.htmlFiles) {
      const localPath = path.join(conversionResult.outputDirectory, htmlFile);
      const s3Key = `${outputPrefix}${htmlFile}`;
      
      await uploadFile(s3Client, bucket, s3Key, localPath, 'text/html', jobId, key, timestamp, requestId);
      uploadedFiles.htmlFiles.push(s3Key);
      uploadedFiles.totalUploaded++;
      
      console.log(`Uploaded HTML: s3://${bucket}/${s3Key}`);
    }

    // Upload CSS files
    for (const cssFile of conversionResult.cssFiles) {
      const localPath = path.join(conversionResult.outputDirectory, cssFile);
      const s3Key = `${outputPrefix}${cssFile}`;
      
      await uploadFile(s3Client, bucket, s3Key, localPath, 'text/css', jobId, key, timestamp, requestId);
      uploadedFiles.cssFiles.push(s3Key);
      uploadedFiles.totalUploaded++;
      
      console.log(`Uploaded CSS: s3://${bucket}/${s3Key}`);
    }

    // Upload image files
    for (const imageFile of conversionResult.imageFiles) {
      const localPath = path.join(conversionResult.outputDirectory, imageFile);
      const s3Key = `${outputPrefix}${imageFile}`;
      
      const contentType = getImageContentType(imageFile);
      await uploadFile(s3Client, bucket, s3Key, localPath, contentType, jobId, key, timestamp, requestId);
      uploadedFiles.imageFiles.push(s3Key);
      uploadedFiles.totalUploaded++;
      
      console.log(`Uploaded Image: s3://${bucket}/${s3Key}`);
    }

    // Create and upload a summary manifest file
    const manifestContent = {
      jobId,
      sourceFile: key,
      conversionTimestamp: timestamp,
      conversionResults: {
        totalFiles: uploadedFiles.totalUploaded,
        htmlFiles: uploadedFiles.htmlFiles,
        cssFiles: uploadedFiles.cssFiles,
        imageFiles: uploadedFiles.imageFiles,
      },
      metadata: {
        originalSize: conversionResult.totalFiles,
        processingWorkflow: 'validate → download → convert → upload → cleanup',
        accessibilityFeatures: [
          'semantic HTML structure',
          'proper heading hierarchy',
          'alt text for images',
          'accessible table markup',
          'color contrast compliance',
          'screen reader compatibility'
        ],
      },
      s3Locations: {
        baseUrl: `s3://${bucket}/${outputPrefix}`,
        primaryHtml: uploadedFiles.htmlFiles[0] || null,
        stylesheets: uploadedFiles.cssFiles,
        images: uploadedFiles.imageFiles,
      },
    };

    const manifestKey = `${outputPrefix}${baseFileName}_manifest.json`;
    const manifestPath = path.join(conversionResult.outputDirectory, `${baseFileName}_manifest.json`);
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2));
    await uploadFile(s3Client, bucket, manifestKey, manifestPath, 'application/json', jobId, key, timestamp, requestId);
    
    console.log(`Uploaded manifest: s3://${bucket}/${manifestKey}`);

    const uploadTimeSeconds = (Date.now() - startTime) / 1000;
    
    console.log(`Upload completed successfully in ${uploadTimeSeconds.toFixed(2)} seconds`);
    console.log(`Total files uploaded: ${uploadedFiles.totalUploaded + 1} (including manifest)`);

    return {
      jobId,
      status: 'UPLOADED',
      uploadedFiles,
      uploadTimeSeconds,
      nextStep: 'CLEANUP',
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const uploadTimeSeconds = (Date.now() - startTime) / 1000;
    
    console.error(`Upload failed for job ${jobId} after ${uploadTimeSeconds.toFixed(2)} seconds:`, errorMessage);

    return {
      jobId,
      status: 'FAILED',
      error: errorMessage,
      uploadTimeSeconds,
      nextStep: 'FAILED',
    };
  }
};

async function uploadFile(
  s3Client: S3Client,
  bucket: string,
  key: string,
  localPath: string,
  contentType: string,
  jobId: string,
  sourceKey: string,
  timestamp: string,
  requestId: string
): Promise<void> {
  
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file not found: ${localPath}`);
  }

  const fileContent = fs.readFileSync(localPath);
  const fileSize = fileContent.length;

  const putObjectCommand = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileContent,
    ContentType: contentType,
    Metadata: {
      'job-id': jobId,
      'source-key': sourceKey,
      'conversion-timestamp': timestamp,
      'request-id': requestId,
      'file-size': fileSize.toString(),
      'processing-stage': 'upload',
      'workflow': 'step-functions',
    },
    // Add cache control for web assets
    CacheControl: contentType.startsWith('text/') || contentType.includes('json') 
      ? 'public, max-age=86400' // 24 hours for text files
      : 'public, max-age=604800', // 7 days for images
  });

  await s3Client.send(putObjectCommand);
}

function getImageContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}