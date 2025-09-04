import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Effect, ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { 
  Choice, 
  Condition, 
  DefinitionBody, 
  Fail, 
  StateMachine, 
  Succeed 
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import type { Construct } from 'constructs';
import { S3EventBridgeLambdaTrigger } from './s3eventbridge-lambda-trigger';

const rootDir = `${__dirname}/..`;

export class InfrastructureStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a single private S3 bucket for both PDFs and HTML outputs
    const contentBucket = new Bucket(this, 'ContentAccessibilityBucket', {
      bucketName: `content-accessibility-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
      removalPolicy: RemovalPolicy.DESTROY, // For development - change for production
      autoDeleteObjects: true, // For development - change for production
      versioned: false,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL, // Private bucket
      publicReadAccess: false,
    });

    // Create IAM role for Lambda functions
    const lambdaExecutionRole = new Role(this, 'ContentAccessibilityLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
      inlinePolicies: {
        S3Access: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket', 's3:HeadObject'],
              resources: [contentBucket.bucketArn, `${contentBucket.bucketArn}/*`],
            }),
          ],
        }),
        BedrockAccess: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['bedrock-data-automation:*', 'bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
              resources: ['*'], // Bedrock resources are region-specific
            }),
          ],
        }),
      },
    });

    // Create the Step Function first (we'll need its ARN for the trigger function)
    const stepFunction = new StateMachine(this, 'ContentAccessibilityStateMachine', {
      definitionBody: DefinitionBody.fromString('{}'), // Temporary - we'll update this after creating Lambda functions
    });

    // Create simplified Lambda functions

    // 1. Trigger Function - Processes S3 events and starts Step Function executions
    const triggerFunction = new NodejsFunction(this, 'TriggerFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        STATE_MACHINE_ARN: stepFunction.stateMachineArn,
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/trigger.ts`,
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/client-sfn', 'aws-lambda'],
      },
    });

    // 2. PDF Processor Function - Main worker that handles validate, download, convert, upload, cleanup
    const pdfProcessorFunction = new NodejsFunction(this, 'PdfProcessorFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(15),
      memorySize: 1024,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/pdf-processor.ts`,
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/client-s3', 'aws-lambda'],
      },
    });

    // 3. Error Handler Function - Handles errors and generates reports
    const errorHandlerFunction = new NodejsFunction(this, 'ErrorHandlerFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/error-handler.ts`,
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/client-s3', 'aws-lambda'],
      },
    });

    // Grant Step Function permission to start executions (for trigger function)
    stepFunction.grantStartExecution(lambdaExecutionRole);

    // Create Step Function tasks for the simplified architecture
    
    // Task 1: PDF Processing (validate + download + convert + upload + cleanup)
    const processPdfTask = new LambdaInvoke(this, 'ProcessPdfTask', {
      lambdaFunction: pdfProcessorFunction,
      inputPath: '$',
      outputPath: '$',
      resultPath: '$.processing',
      payloadResponseOnly: false,
    });

    processPdfTask.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
      interval: Duration.seconds(3),
      maxAttempts: 2,
      backoffRate: 2.0,
    });

    // Error Handler Task
    const handleErrorTask = new LambdaInvoke(this, 'HandleErrorTask', {
      lambdaFunction: errorHandlerFunction,
      inputPath: '$',
      outputPath: '$',
      resultPath: '$.errorHandling',
      payloadResponseOnly: false,
    });

    // Create Choice state for processing result
    const processingChoice = new Choice(this, 'CheckProcessingResult', {
      comment: 'Check if PDF processing was successful',
    });

    // Success and Fail states
    const successState = new Succeed(this, 'ConversionCompleted', {
      comment: 'PDF to HTML conversion completed successfully',
    });

    const processingFailedState = new Fail(this, 'ProcessingFailed', {
      comment: 'PDF processing failed',
      cause: 'PDF processing error',
    });

    const generalFailedState = new Fail(this, 'WorkflowFailed', {
      comment: 'Workflow failed after error handling',
      cause: 'General workflow failure',
    });

    // Set up the simplified workflow with error handling
    processingChoice
      .when(
        Condition.stringEquals('$.processing.Payload.status', 'COMPLETED'),
        successState
      )
      .when(
        Condition.stringEquals('$.processing.Payload.status', 'FAILED'),
        processingFailedState
      )
      .otherwise(processingFailedState);

    // Set up error handling for the main task
    processPdfTask.addCatch(handleErrorTask, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Error handler routes to general failure
    handleErrorTask.next(generalFailedState);

    // Create the simplified workflow chain
    const workflowDefinition = processPdfTask
      .next(processingChoice);

    // Update the Step Function with the proper definition
    const updatedStateMachine = new StateMachine(this, 'UpdatedContentAccessibilityStateMachine', {
      definitionBody: DefinitionBody.fromChainable(workflowDefinition),
      timeout: Duration.minutes(30),
    });

    // Replace the original step function reference
    const stateMachine = updatedStateMachine;

    // Grant Step Function permission to invoke the simplified Lambda functions
    pdfProcessorFunction.grantInvoke(stateMachine);
    errorHandlerFunction.grantInvoke(stateMachine);

    // Update the S3 event trigger to use the new Lambda trigger approach
    const pattern = new S3EventBridgeLambdaTrigger(this, 'S3TriggerPattern', {
      sourceBucket: contentBucket,
      triggerFunction: triggerFunction,
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [contentBucket.bucketName],
          },
          object: { key: [{ wildcard: 'pdfs/*.pdf' }] },
        },
      },
    });

    // Output important values
    new CfnOutput(this, 'ContentBucketName', {
      value: contentBucket.bucketName,
      description: 'S3 bucket for PDF inputs (pdfs/) and HTML outputs (htmls/)',
    });

    new CfnOutput(this, 'StepFunctionArn', {
      value: stateMachine.stateMachineArn,
      description: 'ARN of the simplified PDF to HTML conversion workflow',
    });

    new CfnOutput(this, 'TriggerFunctionName', {
      value: triggerFunction.functionName,
      description: 'Name of the trigger Lambda function that processes S3 events',
    });

    new CfnOutput(this, 'PdfProcessorFunctionName', {
      value: pdfProcessorFunction.functionName,
      description: 'Name of the main PDF processor Lambda function',
    });

    new CfnOutput(this, 'ErrorHandlerFunctionName', {
      value: errorHandlerFunction.functionName,
      description: 'Name of the error handler Lambda function',
    });

    new CfnOutput(this, 'EventBridgeRuleArn', {
      value: pattern.eventRule.ruleArn,
      description: 'ARN of the EventBridge rule that triggers the workflow',
    });
  }
}
