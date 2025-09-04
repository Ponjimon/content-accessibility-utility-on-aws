import type { Context } from 'aws-lambda';
import * as fs from 'fs';

interface CleanupEvent {
  jobId: string;
  workingDirectory?: string;
  uploadedFiles?: {
    totalUploaded: number;
    outputLocation: string;
  };
  processingTimeSeconds?: number;
  timestamp: string;
  requestId: string;
}

interface CleanupResponse {
  jobId: string;
  status: 'COMPLETED' | 'COMPLETED_WITH_WARNINGS';
  summary: {
    totalProcessingTimeSeconds: number;
    filesProcessed: number;
    outputLocation: string;
    cleanupTimeSeconds: number;
    tempFilesRemoved: boolean;
    warnings: string[];
  };
  finalStatus: 'SUCCESS';
}

export const handler = async (event: CleanupEvent, context: Context): Promise<CleanupResponse> => {
  const startTime = Date.now();
  
  console.log('Cleanup Lambda started');
  console.log('Event:', JSON.stringify(event, null, 2));

  const { jobId, workingDirectory, uploadedFiles, processingTimeSeconds, timestamp, requestId } = event;
  const warnings: string[] = [];
  let tempFilesRemoved = false;

  try {
    console.log(`Starting cleanup for job ${jobId}`);

    // Clean up temporary files
    if (workingDirectory) {
      try {
        if (fs.existsSync(workingDirectory)) {
          console.log(`Removing temporary directory: ${workingDirectory}`);
          
          // Get directory info before deletion for logging
          const files = fs.readdirSync(workingDirectory, { recursive: true });
          console.log(`Found ${files.length} temporary files to remove`);
          
          // Remove the entire working directory
          fs.rmSync(workingDirectory, { recursive: true, force: true });
          tempFilesRemoved = true;
          
          console.log(`Successfully removed temporary directory and ${files.length} files`);
        } else {
          console.log('Working directory does not exist, skipping cleanup');
          tempFilesRemoved = true; // Consider this successful
        }
      } catch (cleanupError) {
        const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.warn(`Warning: Failed to cleanup temporary files: ${errorMessage}`);
        warnings.push(`Failed to cleanup temporary files: ${errorMessage}`);
        tempFilesRemoved = false;
      }
    } else {
      console.log('No working directory specified, skipping file cleanup');
      tempFilesRemoved = true; // No files to clean up
    }

    // Log final processing statistics
    const cleanupTimeSeconds = (Date.now() - startTime) / 1000;
    const totalProcessingTime = processingTimeSeconds || 0;
    const filesProcessed = uploadedFiles?.totalUploaded || 0;
    const outputLocation = uploadedFiles?.outputLocation || 'unknown';

    console.log(`
=== Job ${jobId} Completion Summary ===
Total Processing Time: ${totalProcessingTime.toFixed(2)} seconds
Cleanup Time: ${cleanupTimeSeconds.toFixed(2)} seconds
Files Processed: ${filesProcessed}
Output Location: ${outputLocation}
Temp Files Cleaned: ${tempFilesRemoved}
Warnings: ${warnings.length}
Request ID: ${requestId}
Timestamp: ${timestamp}
=====================================
    `);

    // Determine final status
    const finalStatus = warnings.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';

    const summary = {
      totalProcessingTimeSeconds: totalProcessingTime + cleanupTimeSeconds,
      filesProcessed,
      outputLocation,
      cleanupTimeSeconds,
      tempFilesRemoved,
      warnings,
    };

    console.log(`Cleanup completed successfully for job ${jobId}`);

    return {
      jobId,
      status: finalStatus,
      summary,
      finalStatus: 'SUCCESS',
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const cleanupTimeSeconds = (Date.now() - startTime) / 1000;
    
    console.error(`Cleanup failed for job ${jobId} after ${cleanupTimeSeconds.toFixed(2)} seconds:`, errorMessage);
    
    // Even if cleanup fails, we consider the overall job successful if we got this far
    // The conversion and upload were successful, cleanup failure is not critical
    warnings.push(`Cleanup process failed: ${errorMessage}`);

    const summary = {
      totalProcessingTimeSeconds: (processingTimeSeconds || 0) + cleanupTimeSeconds,
      filesProcessed: uploadedFiles?.totalUploaded || 0,
      outputLocation: uploadedFiles?.outputLocation || 'unknown',
      cleanupTimeSeconds,
      tempFilesRemoved,
      warnings,
    };

    return {
      jobId,
      status: 'COMPLETED_WITH_WARNINGS',
      summary,
      finalStatus: 'SUCCESS',
    };
  }
};