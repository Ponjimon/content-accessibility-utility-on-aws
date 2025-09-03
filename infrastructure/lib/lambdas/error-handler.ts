import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Context } from 'aws-lambda';

interface ErrorHandlerEvent {
  bucket?: string;
  inputKey?: string;
  outputPrefix?: string;
  jobId?: string;
  timestamp?: string;
  requestId?: string;
  error?: {
    Error: string;
    Cause: string;
  };
  [key: string]: any; // Allow for additional properties from Step Function context
}

interface ErrorHandlerResponse {
  jobId: string;
  status: 'ERROR_HANDLED';
  errorReport: {
    timestamp: string;
    inputLocation?: string;
    errorType: string;
    errorMessage: string;
    errorDetails: string;
    errorReportLocation?: string;
  };
  error: string;
}

export const handler = async (event: ErrorHandlerEvent, context: Context): Promise<ErrorHandlerResponse> => {
  console.log('Error Handler Lambda started');
  console.log('Event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));
  
  try {
    const jobId = event.jobId || `error-${context.awsRequestId}`;
    const timestamp = new Date().toISOString();
    const contentBucket = process.env.CONTENT_BUCKET;
    
    // Extract error information
    let errorType = 'UnknownError';
    let errorMessage = 'An unknown error occurred during PDF conversion';
    let errorDetails = 'No additional details available';
    
    if (event.error) {
      errorType = event.error.Error || 'ProcessingError';
      errorMessage = event.error.Cause || errorMessage;
      
      // Try to parse the cause if it's JSON
      try {
        const parsedCause = JSON.parse(event.error.Cause);
        if (parsedCause.errorMessage) {
          errorMessage = parsedCause.errorMessage;
        }
        if (parsedCause.errorType) {
          errorType = parsedCause.errorType;
        }
        errorDetails = JSON.stringify(parsedCause, null, 2);
      } catch {
        errorDetails = event.error.Cause || errorDetails;
      }
    }
    
    console.log(`Handling error for job ${jobId}: ${errorType} - ${errorMessage}`);
    
    // Create comprehensive error report
    const errorReport = {
      timestamp,
      jobId,
      inputLocation: event.bucket && event.inputKey ? `s3://${event.bucket}/${event.inputKey}` : undefined,
      errorType,
      errorMessage,
      errorDetails,
      requestId: context.awsRequestId,
      originalEvent: event,
      context: {
        functionName: context.functionName,
        functionVersion: context.functionVersion,
        memoryLimitInMB: context.memoryLimitInMB,
        remainingTimeInMs: context.getRemainingTimeInMillis()
      }
    };
    
    console.log('Error report created:', JSON.stringify(errorReport, null, 2));
    
    // If we have access to S3, save the error report
    let errorReportLocation: string | undefined;
    
    if (contentBucket) {
      try {
        const s3Client = new S3Client({});
        const errorReportKey = `errors/${jobId}-error-report-${timestamp.replace(/[:.]/g, '-')}.json`;
        
        const putObjectCommand = new PutObjectCommand({
          Bucket: contentBucket,
          Key: errorReportKey,
          Body: JSON.stringify(errorReport, null, 2),
          ContentType: 'application/json',
          Metadata: {
            'job-id': jobId,
            'error-type': errorType,
            'timestamp': timestamp,
            'request-id': context.awsRequestId
          }
        });
        
        await s3Client.send(putObjectCommand);
        errorReportLocation = `s3://${contentBucket}/${errorReportKey}`;
        
        console.log(`Error report saved to: ${errorReportLocation}`);
        
      } catch (s3Error) {
        console.error('Failed to save error report to S3:', s3Error);
        // Continue without failing - we still want to return the error information
      }
    }
    
    // Create a user-friendly error HTML file if possible
    if (contentBucket && event.bucket && event.inputKey && event.outputPrefix) {
      try {
        const s3Client = new S3Client({});
        const errorHtmlContent = createErrorHtmlReport(errorReport, event);
        const errorHtmlKey = `${event.outputPrefix}error-${jobId}.html`;
        
        const putHtmlCommand = new PutObjectCommand({
          Bucket: contentBucket,
          Key: errorHtmlKey,
          Body: errorHtmlContent,
          ContentType: 'text/html',
          Metadata: {
            'job-id': jobId,
            'error-type': errorType,
            'timestamp': timestamp,
            'request-id': context.awsRequestId
          }
        });
        
        await s3Client.send(putHtmlCommand);
        
        console.log(`Error HTML report saved to: s3://${contentBucket}/${errorHtmlKey}`);
        
      } catch (htmlError) {
        console.error('Failed to save error HTML report:', htmlError);
      }
    }
    
    // Return the error response
    const response: ErrorHandlerResponse = {
      jobId,
      status: 'ERROR_HANDLED',
      errorReport: {
        timestamp,
        inputLocation: event.bucket && event.inputKey ? `s3://${event.bucket}/${event.inputKey}` : undefined,
        errorType,
        errorMessage,
        errorDetails,
        errorReportLocation
      },
      error: errorMessage
    };
    
    console.log('Error handling completed:', JSON.stringify(response, null, 2));
    
    return response;
    
  } catch (handlerError) {
    const handlerErrorMessage = handlerError instanceof Error ? handlerError.message : String(handlerError);
    
    console.error('Critical error in error handler:', handlerErrorMessage);
    
    // Return a minimal error response
    return {
      jobId: event.jobId || `critical-error-${context.awsRequestId}`,
      status: 'ERROR_HANDLED',
      errorReport: {
        timestamp: new Date().toISOString(),
        errorType: 'CriticalHandlerError',
        errorMessage: 'Error handler itself failed',
        errorDetails: handlerErrorMessage
      },
      error: `Critical error in error handler: ${handlerErrorMessage}`
    };
  }
};

function createErrorHtmlReport(errorReport: any, originalEvent: ErrorHandlerEvent): string {
  const inputFileName = originalEvent.inputKey ? originalEvent.inputKey.split('/').pop() : 'unknown';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PDF Conversion Error Report</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px; 
            line-height: 1.6; 
            background-color: #fff;
        }
        .error-banner { 
            background-color: #f8d7da; 
            border: 1px solid #f5c6cb; 
            color: #721c24;
            border-radius: 5px; 
            padding: 15px; 
            margin-bottom: 20px; 
        }
        .error-details { 
            background-color: #f9f9f9; 
            border-left: 4px solid #dc3545; 
            padding: 15px; 
            margin: 10px 0; 
        }
        .metadata { 
            background-color: #e8f4fd; 
            border-left: 4px solid #0066cc; 
            padding: 10px 15px; 
            margin: 10px 0; 
        }
        .actions {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 5px;
            margin-top: 20px;
        }
        code {
            background-color: #f4f4f4;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: monospace;
        }
        pre {
            background-color: #f4f4f4;
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
            white-space: pre-wrap;
        }
    </style>
</head>
<body>
    <div class="error-banner">
        <h1>⚠️ PDF Conversion Failed</h1>
        <p><strong>File:</strong> ${inputFileName}</p>
        <p><strong>Job ID:</strong> ${errorReport.jobId}</p>
        <p><strong>Error Time:</strong> ${errorReport.timestamp}</p>
    </div>
    
    <div class="error-details">
        <h2>Error Details</h2>
        <p><strong>Error Type:</strong> <code>${errorReport.errorType}</code></p>
        <p><strong>Error Message:</strong> ${errorReport.errorMessage}</p>
        
        ${errorReport.inputLocation ? `<p><strong>Source File:</strong> <code>${errorReport.inputLocation}</code></p>` : ''}
        ${errorReport.errorReportLocation ? `<p><strong>Detailed Report:</strong> <code>${errorReport.errorReportLocation}</code></p>` : ''}
    </div>
    
    <div class="metadata">
        <h2>Processing Information</h2>
        <ul>
            <li><strong>Request ID:</strong> <code>${errorReport.requestId}</code></li>
            <li><strong>Function:</strong> <code>${errorReport.context?.functionName || 'N/A'}</code></li>
            <li><strong>Timestamp:</strong> ${errorReport.timestamp}</li>
        </ul>
    </div>
    
    <div class="actions">
        <h3>Recommended Actions</h3>
        <ul>
            <li><strong>Check the PDF file:</strong> Ensure the PDF is not corrupted and is a valid PDF document</li>
            <li><strong>File size:</strong> Very large PDFs may timeout during processing - consider breaking into smaller files</li>
            <li><strong>Permissions:</strong> Verify that all AWS permissions are correctly configured</li>
            <li><strong>Retry:</strong> You can retry by re-uploading the PDF file to the <code>pdfs/</code> folder</li>
            <li><strong>Support:</strong> If the issue persists, contact support with the Job ID: <code>${errorReport.jobId}</code></li>
        </ul>
    </div>
    
    ${errorReport.errorDetails && errorReport.errorDetails !== errorReport.errorMessage ? `
    <div class="error-details">
        <h3>Technical Details</h3>
        <pre><code>${errorReport.errorDetails}</code></pre>
    </div>
    ` : ''}
</body>
</html>`;
}