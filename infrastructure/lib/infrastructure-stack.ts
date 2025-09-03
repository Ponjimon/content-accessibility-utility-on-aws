import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const rootDir = path.resolve(__dirname, '..');

    // Create a single private S3 bucket for both PDFs and HTML outputs
    const contentBucket = new s3.Bucket(this, 'ContentAccessibilityBucket', {
      bucketName: `content-accessibility-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development - change for production
      autoDeleteObjects: true, // For development - change for production
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Private bucket
      publicReadAccess: false,
    });

    // Create CloudWatch Log Group for Step Function
    const stepFunctionLogGroup = new logs.LogGroup(this, 'PdfToHtmlStepFunctionLogs', {
      logGroupName: '/aws/stepfunctions/content-accessibility-pdf-to-html',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create IAM role for Lambda functions
    const lambdaExecutionRole = new iam.Role(this, 'ContentAccessibilityLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
              ],
              resources: [
                contentBucket.bucketArn,
                `${contentBucket.bucketArn}/*`,
              ],
            }),
          ],
        }),
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock-data-automation:*',
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: ['*'], // Bedrock resources are region-specific
            }),
          ],
        }),
      },
    });

    // Create Lambda function for PDF to HTML conversion processing
    const pdfConverterFunction = new NodejsFunction(this, 'PdfConverterFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.minutes(15), // Long timeout for PDF processing
      memorySize: 3008, // Max memory for better performance
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: path.join(rootDir, 'lib/lambdas/pdf-converter.ts'),
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/client-s3', 'aws-lambda'],
        dockerImage: lambda.Runtime.NODEJS_20_X.bundlingImage,
        forceDockerBundling: false,
      },
    });

    // Create Lambda function for error handling and cleanup
    const errorHandlerFunction = new NodejsFunction(this, 'ErrorHandlerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: path.join(rootDir, 'lib/lambdas/error-handler.ts'),
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/client-s3', 'aws-lambda'],
        dockerImage: lambda.Runtime.NODEJS_20_X.bundlingImage,
        forceDockerBundling: false,
      },
    });

    // Define Step Function states with proper error handling
    const convertPdfTask = new stepfunctionTasks.LambdaInvoke(this, 'ConvertPdfToHtml', {
      lambdaFunction: pdfConverterFunction,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Add retry configuration to the convert task
    convertPdfTask.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    const handleErrorTask = new stepfunctionTasks.LambdaInvoke(this, 'HandleError', {
      lambdaFunction: errorHandlerFunction,
      outputPath: '$.Payload',
    });

    const successState = new stepfunctions.Succeed(this, 'ConversionSuccess', {
      comment: 'PDF to HTML conversion completed successfully',
    });

    const failState = new stepfunctions.Fail(this, 'ConversionFailed', {
      comment: 'PDF to HTML conversion failed after retries',
    });

    // Create the Step Function definition with error handling
    convertPdfTask.addCatch(handleErrorTask, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const definition = convertPdfTask
      .next(successState);

    handleErrorTask.next(failState);

    // Create the Step Function
    const stepFunction = new stepfunctions.StateMachine(this, 'ContentAccessibilityStateMachine', {
      stateMachineName: 'content-accessibility-pdf-to-html',
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(1), // Overall timeout for the workflow
      logs: {
        destination: stepFunctionLogGroup,
        level: stepfunctions.LogLevel.ALL,
      },
    });

    // Grant Step Function permission to invoke Lambda functions
    pdfConverterFunction.grantInvoke(stepFunction);
    errorHandlerFunction.grantInvoke(stepFunction);

    // Create Lambda function to trigger Step Function on S3 events
    const triggerFunction = new NodejsFunction(this, 'TriggerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        STEP_FUNCTION_ARN: stepFunction.stateMachineArn,
        CONTENT_BUCKET: contentBucket.bucketName,
      },
      entry: path.join(rootDir, 'lib/lambdas/trigger.ts'),
      bundling: {
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        minify: true,
        format: OutputFormat.ESM,
        tsconfig: `${rootDir}/tsconfig.json`,
        sourceMap: true,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/client-s3', '@aws-sdk/client-sfn', 'aws-lambda'],
        dockerImage: lambda.Runtime.NODEJS_20_X.bundlingImage,
        forceDockerBundling: false,
      },
    });

    // Grant permissions for trigger function to start Step Function execution
    stepFunction.grantStartExecution(triggerFunction);

    // Add S3 event notification to trigger Step Function when PDFs are uploaded
    contentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(triggerFunction),
      { prefix: 'pdfs/', suffix: '.pdf' }
    );

    // Output important values
    new cdk.CfnOutput(this, 'ContentBucketName', {
      value: contentBucket.bucketName,
      description: 'S3 bucket for PDF inputs (pdfs/) and HTML outputs (htmls/)',
    });

    new cdk.CfnOutput(this, 'StepFunctionArn', {
      value: stepFunction.stateMachineArn,
      description: 'ARN of the Step Function for PDF to HTML conversion',
    });

    new cdk.CfnOutput(this, 'PdfConverterFunctionName', {
      value: pdfConverterFunction.functionName,
      description: 'Name of the PDF converter Lambda function',
    });

    new cdk.CfnOutput(this, 'TriggerFunctionName', {
      value: triggerFunction.functionName,
      description: 'Name of the S3 trigger Lambda function',
    });
  }
}
