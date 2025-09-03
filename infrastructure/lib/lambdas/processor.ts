import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Context } from 'aws-lambda';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ProcessorEvent {
  jobId?: string;
  inputS3Bucket: string;
  inputS3Key: string;
  outputS3Bucket: string;
  outputS3Prefix?: string;
  conversionOptions?: Record<string, any>;
}

interface ConversionResult {
  html_path: string;
  output_files: string[];
  pdf_pages: number;
  images_extracted: number;
  processing_time_seconds: number;
}

interface ProcessorResponse {
  jobId: string;
  status: 'COMPLETED' | 'FAILED';
  outputLocation?: string;
  conversionResult?: ConversionResult;
  inputLocation: string;
  error?: string;
}

exports.handler = async (event: ProcessorEvent, context: Context): Promise<ProcessorResponse> => {
  try {
    // Extract required parameters from event
    const jobId = event.jobId || `job-${context.awsRequestId}`;
    const inputBucket = event.inputS3Bucket;
    const inputKey = decodeURIComponent(event.inputS3Key);
    const outputBucket = event.outputS3Bucket;
    const outputPrefix = event.outputS3Prefix || 'converted/';
    const conversionOptions = event.conversionOptions || {};
    
    console.log(`Processing job ${jobId}: Converting ${inputBucket}/${inputKey}`);
    
    // Initialize AWS S3 client
    const s3Client = new S3Client({});
    
    // Create temporary file for PDF download
    const tempDir = os.tmpdir();
    const tempPdfPath = path.join(tempDir, `${jobId}.pdf`);
    
    try {
      // Download PDF file to temporary location
      const getObjectCommand = new GetObjectCommand({
        Bucket: inputBucket,
        Key: inputKey
      });
      
      const response = await s3Client.send(getObjectCommand);
      
      if (!response.Body) {
        throw new Error('No data received from S3');
      }
      
      // Convert stream to buffer and write to temp file
      const chunks: Uint8Array[] = [];
      const stream = response.Body as any;
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(tempPdfPath, buffer);
      
      const pdfSize = fs.statSync(tempPdfPath).size;
      console.log(`Downloaded PDF file: ${pdfSize} bytes`);
      
    } catch (error) {
      throw new Error(`Failed to download PDF: ${error}`);
    }
    
    // Create HTML content (placeholder implementation)
    const htmlContent = createHtmlContent(jobId, inputKey, inputBucket, fs.statSync(tempPdfPath).size, conversionOptions, context.awsRequestId);
    
    // Upload HTML result to output bucket
    const outputKey = `${outputPrefix}${jobId}/converted.html`;
    const putObjectCommand = new PutObjectCommand({
      Bucket: outputBucket,
      Key: outputKey,
      Body: htmlContent,
      ContentType: 'text/html',
      Metadata: {
        'job-id': jobId,
        'source-bucket': inputBucket,
        'source-key': inputKey,
        'conversion-timestamp': context.awsRequestId
      }
    });
    
    await s3Client.send(putObjectCommand);
    
    // Create conversion result
    const conversionResult: ConversionResult = {
      html_path: `s3://${outputBucket}/${outputKey}`,
      output_files: [outputKey],
      pdf_pages: 1,
      images_extracted: 0,
      processing_time_seconds: 1.0
    };
    
    // Construct output location
    const outputLocation = `s3://${outputBucket}/${outputPrefix}${jobId}/`;
    
    // Cleanup temporary file
    try {
      fs.unlinkSync(tempPdfPath);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    // Return success response
    const response: ProcessorResponse = {
      jobId,
      status: 'COMPLETED',
      outputLocation,
      conversionResult,
      inputLocation: `s3://${inputBucket}/${inputKey}`
    };
    
    console.log(`Job ${jobId} completed successfully`);
    return response;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const jobId = event.jobId || 'unknown';
    console.log(`Job ${jobId} failed: ${errorMessage}`);
    
    // Return failure response
    return {
      jobId,
      status: 'FAILED',
      error: errorMessage,
      inputLocation: `s3://${event.inputS3Bucket || ''}/${event.inputS3Key || ''}`
    };
  }
};

function createHtmlContent(jobId: string, inputKey: string, inputBucket: string, pdfSize: number, conversionOptions: Record<string, any>, requestId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Converted PDF Document</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
        .conversion-info { background-color: #f0f8ff; border: 1px solid #0066cc; border-radius: 5px; padding: 15px; margin-bottom: 20px; }
        .metadata { background-color: #f9f9f9; border-left: 4px solid #ccc; padding: 10px 15px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="conversion-info">
        <h1>PDF to HTML Conversion Result</h1>
        <p><strong>Job ID:</strong> ${jobId}</p>
        <p><strong>Original File:</strong> ${inputKey}</p>
        <p><strong>Request ID:</strong> ${requestId}</p>
    </div>
    
    <div class="metadata">
        <h2>Document Metadata</h2>
        <ul>
            <li><strong>Source:</strong> s3://${inputBucket}/${inputKey}</li>
            <li><strong>File Size:</strong> ${pdfSize.toLocaleString()} bytes</li>
            <li><strong>Processing Options:</strong> ${JSON.stringify(conversionOptions, null, 2)}</li>
        </ul>
    </div>
    
    <div class="content">
        <h2>Document Content</h2>
        <p><em>This is a Step Function workflow demonstration. The actual implementation would integrate with the content accessibility utility's PDF to HTML conversion capabilities.</em></p>
        
        <p>In a full implementation, this would:</p>
        <ul>
            <li>Use AWS Bedrock Data Automation (BDA) for PDF parsing</li>
            <li>Extract text, images, and structure from the PDF</li>
            <li>Generate accessible HTML with proper semantic markup</li>
            <li>Include extracted images with appropriate alt text</li>
            <li>Preserve document layout and formatting</li>
        </ul>
    </div>
</body>
</html>`;
}