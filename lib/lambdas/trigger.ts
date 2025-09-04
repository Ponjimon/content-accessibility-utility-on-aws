import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { Context, EventBridgeEvent } from 'aws-lambda';

interface S3EventDetail {
  version: string;
  bucket: {
    name: string;
  };
  object: {
    key: string;
    size: number;
    etag: string;
    'version-id'?: string;
  };
  'request-id': string;
  requester: string;
  'source-ip-address': string;
  reason: string;
}

interface TriggerEvent extends EventBridgeEvent<'Object Created', S3EventDetail> {}

interface StepFunctionInput {
  jobId: string;
  bucket: string;
  key: string;
  timestamp: string;
  requestId: string;
  eventType: string;
  fileInfo: {
    size: number;
    etag: string;
  };
}

interface TriggerResponse {
  status: 'TRIGGERED' | 'SKIPPED' | 'FAILED';
  executionArn?: string;
  jobId?: string;
  reason?: string;
  error?: string;
}

export const handler = async (event: TriggerEvent, context: Context): Promise<TriggerResponse> => {
  console.log('Trigger Lambda started');
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { detail, source, 'detail-type': detailType } = event;
    
    // Validate this is an S3 event we care about
    if (source !== 'aws.s3' || detailType !== 'Object Created') {
      return {
        status: 'SKIPPED',
        reason: `Not an S3 Object Created event: source=${source}, detailType=${detailType}`,
      };
    }

    const bucket = detail.bucket.name;
    const key = detail.object.key;
    const size = detail.object.size;
    const etag = detail.object.etag;
    const requestId = detail['request-id'];

    console.log(`Processing S3 event: s3://${bucket}/${key} (${size} bytes)`);

    // Validate the file is in the pdfs/ prefix and is a PDF
    if (!key.startsWith('pdfs/')) {
      return {
        status: 'SKIPPED',
        reason: `File not in pdfs/ prefix: ${key}`,
      };
    }

    if (!key.toLowerCase().endsWith('.pdf')) {
      return {
        status: 'SKIPPED',
        reason: `File is not a PDF: ${key}`,
      };
    }

    // Skip very small files (likely empty or invalid)
    if (size < 100) {
      return {
        status: 'SKIPPED',
        reason: `File too small (${size} bytes): ${key}`,
      };
    }

    // Generate a unique job ID
    const timestamp = new Date().toISOString();
    const shortEtag = etag.replace(/"/g, '').substring(0, 8);
    const jobId = `pdf-conversion-${Date.now()}-${shortEtag}`;

    console.log(`Generated job ID: ${jobId} for file: ${key}`);

    // Create Step Function input
    const stepFunctionInput: StepFunctionInput = {
      jobId,
      bucket,
      key,
      timestamp,
      requestId: context.awsRequestId,
      eventType: 'S3_OBJECT_CREATED',
      fileInfo: {
        size,
        etag,
      },
    };

    // Get Step Function ARN from environment
    const stateMachineArn = process.env.STATE_MACHINE_ARN;
    if (!stateMachineArn) {
      throw new Error('STATE_MACHINE_ARN environment variable not set');
    }

    // Start Step Function execution
    const sfnClient = new SFNClient({});
    
    const startExecutionCommand = new StartExecutionCommand({
      stateMachineArn,
      name: `execution-${jobId}`,
      input: JSON.stringify(stepFunctionInput),
    });

    console.log('Starting Step Function execution...');
    console.log('Input:', JSON.stringify(stepFunctionInput, null, 2));

    const response = await sfnClient.send(startExecutionCommand);
    
    console.log(`Step Function execution started successfully: ${response.executionArn}`);

    return {
      status: 'TRIGGERED',
      executionArn: response.executionArn,
      jobId,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    console.error('Failed to trigger Step Function:', errorMessage);

    return {
      status: 'FAILED',
      error: errorMessage,
    };
  }
};