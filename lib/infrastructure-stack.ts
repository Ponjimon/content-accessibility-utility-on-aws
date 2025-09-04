import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { EventField, RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { Effect, ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { 
  Chain, 
  Choice, 
  Condition, 
  DefinitionBody, 
  Fail, 
  JsonPath, 
  Pass, 
  StateMachine, 
  Succeed, 
  Wait, 
  WaitTime 
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import type { Construct } from 'constructs';
import { join } from 'path';
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

    // Create Lambda functions for each step

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

    // 2. Validate Input Function
    const validateInputFunction = new NodejsFunction(this, 'ValidateInputFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/validate-input.ts`,
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

    // 3. Download PDF Function
    const downloadPdfFunction = new NodejsFunction(this, 'DownloadPdfFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(10),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/download-pdf.ts`,
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

    // 4. Convert PDF Function
    const convertPdfFunction = new NodejsFunction(this, 'ConvertPdfFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(15),
      memorySize: 1024,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/convert-pdf.ts`,
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['aws-lambda'],
      },
    });

    // 5. Upload Results Function
    const uploadResultsFunction = new NodejsFunction(this, 'UploadResultsFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(10),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/upload-results.ts`,
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

    // 6. Cleanup Function
    const cleanupFunction = new NodejsFunction(this, 'CleanupFunction', {
      depsLockFilePath: `${rootDir}/bun.lock`,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: `${rootDir}/lib/lambdas/cleanup.ts`,
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['aws-lambda'],
      },
    });

    // 7. Error Handler Function (updated from original)
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

    // Create Step Function tasks for each Lambda function
    
    // Task 1: Validate Input
    const validateInputTask = new LambdaInvoke(this, 'ValidateInputTask', {
      lambdaFunction: validateInputFunction,
      inputPath: '$',
      outputPath: '$',
      resultPath: '$.validation',
      payloadResponseOnly: false,
    });

    validateInputTask.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    // Task 2: Download PDF
    const downloadPdfTask = new LambdaInvoke(this, 'DownloadPdfTask', {
      lambdaFunction: downloadPdfFunction,
      inputPath: '$',
      outputPath: '$',
      resultPath: '$.download',
      payloadResponseOnly: false,
    });

    downloadPdfTask.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    // Task 3: Convert PDF
    const convertPdfTask = new LambdaInvoke(this, 'ConvertPdfTask', {
      lambdaFunction: convertPdfFunction,
      inputPath: '$',
      outputPath: '$',
      resultPath: '$.conversion',
      payloadResponseOnly: false,
    });

    convertPdfTask.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
      interval: Duration.seconds(5),
      maxAttempts: 2,
      backoffRate: 2.0,
    });

    // Task 4: Upload Results
    const uploadResultsTask = new LambdaInvoke(this, 'UploadResultsTask', {
      lambdaFunction: uploadResultsFunction,
      inputPath: '$',
      outputPath: '$',
      resultPath: '$.upload',
      payloadResponseOnly: false,
    });

    uploadResultsTask.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
      interval: Duration.seconds(3),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    // Task 5: Cleanup
    const cleanupTask = new LambdaInvoke(this, 'CleanupTask', {
      lambdaFunction: cleanupFunction,
      inputPath: '$',
      outputPath: '$',
      resultPath: '$.cleanup',
      payloadResponseOnly: false,
    });

    cleanupTask.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
      interval: Duration.seconds(2),
      maxAttempts: 2,
      backoffRate: 1.5,
    });

    // Error Handler Task
    const handleErrorTask = new LambdaInvoke(this, 'HandleErrorTask', {
      lambdaFunction: errorHandlerFunction,
      inputPath: '$',
      outputPath: '$',
      resultPath: '$.errorHandling',
      payloadResponseOnly: false,
    });

    // Create Choice states for conditional logic
    
    // Choice 1: Check validation result
    const validateChoice = new Choice(this, 'CheckValidationResult', {
      comment: 'Check if input validation was successful',
    });

    // Choice 2: Check download result
    const downloadChoice = new Choice(this, 'CheckDownloadResult', {
      comment: 'Check if PDF download was successful',
    });

    // Choice 3: Check conversion result
    const conversionChoice = new Choice(this, 'CheckConversionResult', {
      comment: 'Check if PDF conversion was successful',
    });

    // Choice 4: Check upload result
    const uploadChoice = new Choice(this, 'CheckUploadResult', {
      comment: 'Check if file upload was successful',
    });

    // Success and Fail states
    const successState = new Succeed(this, 'ConversionCompleted', {
      comment: 'PDF to HTML conversion workflow completed successfully',
    });

    const validationFailedState = new Fail(this, 'ValidationFailed', {
      comment: 'Input validation failed - invalid PDF file',
      cause: 'Input file validation failed',
    });

    const downloadFailedState = new Fail(this, 'DownloadFailed', {
      comment: 'Failed to download PDF from S3',
      cause: 'PDF download failed',
    });

    const conversionFailedState = new Fail(this, 'ConversionFailed', {
      comment: 'PDF to HTML conversion failed',
      cause: 'PDF conversion failed',
    });

    const uploadFailedState = new Fail(this, 'UploadFailed', {
      comment: 'Failed to upload converted files to S3',
      cause: 'File upload failed',
    });

    const generalFailedState = new Fail(this, 'WorkflowFailed', {
      comment: 'Workflow failed after error handling',
      cause: 'General workflow failure',
    });

    // Add a wait state for rate limiting if needed
    const waitBetweenRetries = new Wait(this, 'WaitBetweenRetries', {
      time: WaitTime.duration(Duration.seconds(1)),
      comment: 'Wait briefly between operations',
    });

    // Create the workflow definition with proper error handling

    // Set up the choice conditions and workflow
    validateChoice
      .when(
        Condition.stringEquals('$.validation.Payload.status', 'VALID'),
        downloadPdfTask
          .next(downloadChoice)
      )
      .when(
        Condition.stringEquals('$.validation.Payload.status', 'INVALID'),
        validationFailedState
      )
      .otherwise(validationFailedState);

    downloadChoice
      .when(
        Condition.stringEquals('$.download.Payload.status', 'DOWNLOADED'),
        convertPdfTask
          .next(conversionChoice)
      )
      .when(
        Condition.stringEquals('$.download.Payload.status', 'FAILED'),
        downloadFailedState
      )
      .otherwise(downloadFailedState);

    conversionChoice
      .when(
        Condition.stringEquals('$.conversion.Payload.status', 'CONVERTED'),
        uploadResultsTask
          .next(uploadChoice)
      )
      .when(
        Condition.stringEquals('$.conversion.Payload.status', 'FAILED'),
        conversionFailedState
      )
      .otherwise(conversionFailedState);

    uploadChoice
      .when(
        Condition.stringEquals('$.upload.Payload.status', 'UPLOADED'),
        cleanupTask
          .next(successState)
      )
      .when(
        Condition.stringEquals('$.upload.Payload.status', 'FAILED'),
        uploadFailedState
      )
      .otherwise(uploadFailedState);

    // Set up error handling for each task
    validateInputTask.addCatch(handleErrorTask, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    downloadPdfTask.addCatch(handleErrorTask, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    convertPdfTask.addCatch(handleErrorTask, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    uploadResultsTask.addCatch(handleErrorTask, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    cleanupTask.addCatch(handleErrorTask, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Error handler routes to general failure
    handleErrorTask.next(generalFailedState);

    // Create the main workflow chain
    const workflowDefinition = validateInputTask
      .next(validateChoice);

    // Update the Step Function with the proper definition
    const updatedStateMachine = new StateMachine(this, 'UpdatedContentAccessibilityStateMachine', {
      definitionBody: DefinitionBody.fromChainable(workflowDefinition),
      timeout: Duration.minutes(30),
    });

    // Replace the original step function reference
    const stateMachine = updatedStateMachine;

    // Grant Step Function permission to invoke all Lambda functions
    validateInputFunction.grantInvoke(stateMachine);
    downloadPdfFunction.grantInvoke(stateMachine);
    convertPdfFunction.grantInvoke(stateMachine);
    uploadResultsFunction.grantInvoke(stateMachine);
    cleanupFunction.grantInvoke(stateMachine);
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
      description: 'ARN of the multi-step PDF to HTML conversion workflow',
    });

    new CfnOutput(this, 'TriggerFunctionName', {
      value: triggerFunction.functionName,
      description: 'Name of the trigger Lambda function that processes S3 events',
    });

    new CfnOutput(this, 'ValidateInputFunctionName', {
      value: validateInputFunction.functionName,
      description: 'Name of the input validation Lambda function',
    });

    new CfnOutput(this, 'DownloadPdfFunctionName', {
      value: downloadPdfFunction.functionName,
      description: 'Name of the PDF download Lambda function',
    });

    new CfnOutput(this, 'ConvertPdfFunctionName', {
      value: convertPdfFunction.functionName,
      description: 'Name of the PDF conversion Lambda function',
    });

    new CfnOutput(this, 'UploadResultsFunctionName', {
      value: uploadResultsFunction.functionName,
      description: 'Name of the upload results Lambda function',
    });

    new CfnOutput(this, 'CleanupFunctionName', {
      value: cleanupFunction.functionName,
      description: 'Name of the cleanup Lambda function',
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
