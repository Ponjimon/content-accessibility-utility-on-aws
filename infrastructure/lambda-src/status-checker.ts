import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Context } from 'aws-lambda';

interface StatusCheckerEvent {
  jobId?: string;
  outputS3Bucket: string;
  outputS3Prefix?: string;
}

interface StatusCheckerResponse {
  jobId: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'FAILED';
  outputLocation: string;
  filesFound?: string[];
  error?: string;
}

export const handler = async (event: StatusCheckerEvent, context: Context): Promise<StatusCheckerResponse> => {
  try {
    const jobId = event.jobId || 'unknown';
    const outputBucket = event.outputS3Bucket;
    const outputPrefix = event.outputS3Prefix || 'converted/';
    
    // Construct the expected output path
    const jobOutputPrefix = `${outputPrefix}${jobId}/`;
    
    console.log(`Checking status for job ${jobId} in ${outputBucket}/${jobOutputPrefix}`);
    
    // Initialize S3 client
    const s3Client = new S3Client({});
    
    // List objects in the job output location
    const listCommand = new ListObjectsV2Command({
      Bucket: outputBucket,
      Prefix: jobOutputPrefix
    });
    
    const response = await s3Client.send(listCommand);
    
    let filesFound: string[] = [];
    let status: 'COMPLETED' | 'IN_PROGRESS' = 'IN_PROGRESS';
    
    if (response.Contents && response.Contents.length > 0) {
      filesFound = response.Contents
        .map(obj => obj.Key?.replace(jobOutputPrefix, '') || '')
        .filter(key => key.length > 0);
      
      // Check if we have the expected output files
      const htmlFiles = filesFound.filter(f => f.endsWith('.html'));
      
      if (htmlFiles.length > 0) {
        status = 'COMPLETED';
        console.log(`Job ${jobId} completed - found ${htmlFiles.length} HTML files`);
      } else {
        status = 'IN_PROGRESS';
        console.log(`Job ${jobId} in progress - found ${filesFound.length} files but no HTML yet`);
      }
    } else {
      status = 'IN_PROGRESS';
      console.log(`Job ${jobId} in progress - no output files found yet`);
    }
    
    // Return status response
    return {
      jobId,
      status,
      outputLocation: `s3://${outputBucket}/${jobOutputPrefix}`,
      filesFound
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const jobId = event.jobId || 'unknown';
    console.log(`Error checking status for job ${jobId}: ${errorMessage}`);
    
    // Return error response
    return {
      jobId,
      status: 'FAILED',
      error: errorMessage,
      outputLocation: `s3://${event.outputS3Bucket}/${event.outputS3Prefix || 'converted/'}${jobId}/`
    };
  }
};