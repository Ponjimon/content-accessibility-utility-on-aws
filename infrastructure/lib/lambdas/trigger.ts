import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { S3Event, Context } from 'aws-lambda';

interface TriggerResponse {
  statusCode: number;
  body: string;
  executionArn?: string;
}

export const handler = async (event: S3Event, context: Context): Promise<TriggerResponse> => {
  console.log('Received S3 event:', JSON.stringify(event, null, 2));

  const stepFunctionArn = process.env.STEP_FUNCTION_ARN;
  const contentBucket = process.env.CONTENT_BUCKET;

  if (!stepFunctionArn) {
    console.error('STEP_FUNCTION_ARN environment variable not set');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Configuration error: STEP_FUNCTION_ARN not set' })
    };
  }

  if (!contentBucket) {
    console.error('CONTENT_BUCKET environment variable not set');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Configuration error: CONTENT_BUCKET not set' })
    };
  }

  try {
    const sfnClient = new SFNClient({});
    const results = [];

    // Process each record in the S3 event
    for (const record of event.Records) {
      const bucketName = record.s3.bucket.name;
      const objectKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      console.log(`Processing S3 object: s3://${bucketName}/${objectKey}`);

      // Validate that this is a PDF file in the pdfs/ prefix
      if (!objectKey.startsWith('pdfs/') || !objectKey.toLowerCase().endsWith('.pdf')) {
        console.log(`Skipping file ${objectKey} - not a PDF in pdfs/ folder`);
        continue;
      }

      // Create a unique execution name based on the object key and timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = objectKey.split('/').pop()?.replace('.pdf', '') || 'unknown';
      const executionName = `pdf-conversion-${fileName}-${timestamp}`;

      // Prepare the input for the Step Function
      const stepFunctionInput = {
        bucket: bucketName,
        inputKey: objectKey,
        outputPrefix: 'htmls/',
        jobId: `job-${context.awsRequestId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        eventType: record.eventName,
        requestId: context.awsRequestId
      };

      console.log(`Starting Step Function execution: ${executionName}`);
      console.log(`Input:`, JSON.stringify(stepFunctionInput, null, 2));

      // Start the Step Function execution
      const command = new StartExecutionCommand({
        stateMachineArn: stepFunctionArn,
        name: executionName,
        input: JSON.stringify(stepFunctionInput)
      });

      const result = await sfnClient.send(command);
      
      console.log(`Step Function execution started: ${result.executionArn}`);
      
      results.push({
        objectKey,
        executionArn: result.executionArn,
        executionName
      });
    }

    if (results.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'No PDF files found in pdfs/ folder to process',
          processedFiles: 0
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successfully triggered ${results.length} Step Function execution(s)`,
        results
      }),
      executionArn: results[0]?.executionArn
    };

  } catch (error) {
    console.error('Error triggering Step Function:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to trigger Step Function',
        details: error instanceof Error ? error.message : String(error)
      })
    };
  }
};